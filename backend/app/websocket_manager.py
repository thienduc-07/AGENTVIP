import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Set, Optional, Dict, Any
from fastapi import WebSocket, status
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import SessionLocal
from backend.app.services.event_service import (
    build_initial_snapshot,
    get_events_after,
)

logger = logging.getLogger("grandline.websocket")

MAX_FRAME_SIZE_BYTES = 64 * 1024  # 64 KB maximum incoming frame

class WebSocketManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.connection_metadata: Dict[WebSocket, Dict[str, Any]] = {}
        self.main_loop = None

    def is_origin_allowed(self, origin: Optional[str]) -> bool:
        """Validates incoming client Origin header against configured CORS origins."""
        if not origin:
            return True
        allowed_origins = [o.rstrip("/") for o in settings.CORS_ORIGINS]
        normalized_origin = origin.rstrip("/")
        if "*" in allowed_origins or normalized_origin in allowed_origins:
            return True
        return False

    async def connect(self, websocket: WebSocket) -> bool:
        """
        Accepts incoming WebSocket connection after origin verification and token authentication.
        Enforces tenant isolation by recording authoritative tenant scope for the connection.
        """
        origin = websocket.headers.get("origin")
        if not self.is_origin_allowed(origin):
            logger.warning(f"Rejected WebSocket connection from unauthorized origin: {origin}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False

        # Authenticate token from query parameter, Authorization header, or Sec-WebSocket-Protocol
        token = websocket.query_params.get("token")
        selected_subprotocol = None
        if not token:
            auth_header = websocket.headers.get("authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ", 1)[1]

        if not token:
            raw_protocols = websocket.headers.get("sec-websocket-protocol", "")
            if raw_protocols:
                for p in [x.strip() for x in raw_protocols.split(",")]:
                    if p.startswith("bearer."):
                        token = p.split(".", 1)[1]
                        selected_subprotocol = p
                        break
                    elif p.startswith("bearer_"):
                        token = p.split("_", 1)[1]
                        selected_subprotocol = p
                        break

        if not token:
            logger.warning("Rejected WebSocket connection: Missing authentication token")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False

        from backend.app.core.auth import decode_jwt_token
        from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
        db = SessionLocal()
        try:
            payload = decode_jwt_token(token)
            user_id = payload.get("sub")
            if not user_id:
                raise ValueError("Missing sub identity claim")

            user = db.query(UserModel).filter(UserModel.id == user_id).first()
            if not user or not user.is_active:
                raise ValueError("Inactive or deleted user")

            current_ver = getattr(user, "token_version", 1)
            token_ver = payload.get("ver")
            if token_ver is None or token_ver < current_ver:
                raise ValueError("Revoked session")

            # Resolve tenant organization server-side
            req_org = websocket.query_params.get("organization_id")
            memberships = (
                db.query(OrganizationMemberModel)
                .join(OrganizationModel, OrganizationMemberModel.organization_id == OrganizationModel.id)
                .filter(OrganizationMemberModel.user_id == user.id, OrganizationModel.is_active == True)
                .all()
            )
            user_orgs = {m.organization_id: m.role for m in memberships}

            if user.is_superadmin:
                tenant_org = req_org
            else:
                if req_org:
                    if req_org not in user_orgs:
                        raise ValueError(f"Forbidden: Access denied to organization '{req_org}'")
                    tenant_org = req_org
                elif user_orgs:
                    tenant_org = next(iter(user_orgs.keys()))
                else:
                    raise ValueError("User has no active organization memberships")

            if selected_subprotocol:
                await websocket.accept(subprotocol=selected_subprotocol)
            else:
                await websocket.accept()

            self.active_connections.add(websocket)
            self.connection_metadata[websocket] = {
                "user_id": user.id,
                "organization_id": tenant_org,
                "is_superadmin": bool(user.is_superadmin),
            }
        except Exception as e:
            logger.warning(f"Rejected WebSocket connection: Authentication failed ({e})")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False
        finally:
            db.close()

        if not self.main_loop:
            try:
                import asyncio
                self.main_loop = asyncio.get_running_loop()
            except RuntimeError:
                pass
        logger.info(f"WebSocket client connected [org={tenant_org}]. Active connections: {len(self.active_connections)}")

        # Send authoritative initial snapshot scoped to client organization
        db = SessionLocal()
        try:
            snapshot = build_initial_snapshot(
                db,
                organization_id=tenant_org,
                is_superadmin=bool(user.is_superadmin),
            )
            await websocket.send_text(json.dumps(snapshot, default=str))
        except Exception as e:
            logger.error(f"Error generating initial snapshot for client: {e}")
        finally:
            db.close()

        return True

    def disconnect(self, websocket: WebSocket) -> None:
        """Removes a client connection cleanly from active tracking."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            self.connection_metadata.pop(websocket, None)
            logger.info(f"WebSocket client disconnected. Remaining connections: {len(self.active_connections)}")

    async def broadcast_envelope(self, envelope: Dict[str, Any], target_org: Optional[str] = None) -> None:
        """
        Broadcasts a standardized Event Envelope to authorized connected clients.
        Strictly prevents cross-tenant event leaks.
        """
        if not self.active_connections:
            return

        effective_org = target_org or envelope.get("organization_id") or envelope.get("payload", {}).get("organization_id")

        message_data = {
            "message_type": "event",
            "event": envelope,
            # Backward compatibility fields for existing UI components
            "type": envelope.get("event_type"),
            "data": envelope.get("payload", {}),
        }
        text_message = json.dumps(message_data, default=str)

        dead_connections = []
        for connection in list(self.active_connections):
            meta = self.connection_metadata.get(connection)
            if not meta:
                # Fail closed: Any connection lacking verified metadata receives zero events
                continue

            is_superadmin = bool(meta.get("is_superadmin", False))
            conn_org = meta.get("organization_id")

            # Tenant isolation policy:
            # - Superadmins with conn_org=None receive all broadcasts globally.
            # - Superadmins with conn_org=<org> receive events for that specific organization.
            # - Standard tenants receive ONLY events matching their authenticated organization_id.
            # - Events with no organization ownership (system/legacy/orphan) fail closed and are NOT broadcast to tenant clients.
            if not is_superadmin:
                if not conn_org or not effective_org or conn_org != effective_org:
                    continue
            elif conn_org and effective_org and conn_org != effective_org:
                continue

            try:
                await connection.send_text(text_message)
            except Exception as e:
                logger.warning(f"Error sending message to client: {e}")
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)

    async def broadcast_event(
        self,
        event_type: str,
        agent_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Broadcasts an event with automatically generated ID and UTC timestamp.
        """
        envelope = {
            "schema_version": 1,
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "agent_id": agent_id,
            "payload": payload or {},
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "sequence_id": None,
        }
        await self.broadcast_envelope(envelope)

    async def broadcast(self, event_type: str, data: dict) -> None:
        """
        Legacy broadcast method preserved for backward compatibility.
        """
        envelope = {
            "schema_version": 1,
            "event_id": f"legacy_{id(data)}",
            "event_type": event_type,
            "occurred_at": None,
            "sequence_id": None,
            "agent_id": data.get("agent_id"),
            "task_id": data.get("task_id"),
            "payload": data,
        }
        await self.broadcast_envelope(envelope)

    def broadcast_sync(self, envelope: Dict[str, Any]) -> None:
        """Schedules asynchronous envelope broadcast from any code context or thread safely."""
        import asyncio
        loop = self.main_loop
        if not loop or loop.is_closed():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                pass

        if loop and loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self.broadcast_envelope(envelope), loop)
            except Exception as e:
                logger.debug(f"Could not dispatch run_coroutine_threadsafe: {e}")

    async def handle_incoming_message(self, websocket: WebSocket, text_data: str) -> None:
        """
        Handles incoming client control messages (ping, replay, resync).
        Enforces maximum frame size and prevents untrusted client state modification.
        """
        if len(text_data) > MAX_FRAME_SIZE_BYTES:
            logger.warning(f"Client sent oversized frame ({len(text_data)} bytes). Dropping.")
            await websocket.send_text(json.dumps({"error": "PAYLOAD_TOO_LARGE"}))
            return

        try:
            msg = json.loads(text_data)
        except json.JSONDecodeError:
            await websocket.send_text(json.dumps({"error": "INVALID_JSON"}))
            return

        action = msg.get("action")
        payload = msg.get("payload", {})

        if action == "ping":
            await websocket.send_text(json.dumps({
                "message_type": "pong",
                "timestamp": payload.get("timestamp") or msg.get("timestamp"),
            }))

        elif action == "resync":
            meta = self.connection_metadata.get(websocket)
            if not meta or (not meta.get("is_superadmin") and not meta.get("organization_id")):
                logger.warning("Rejecting resync: Connection lacks verified tenant organization identity")
                await websocket.send_text(json.dumps({
                    "message_type": "error",
                    "code": "FORBIDDEN",
                    "detail": "Tenant organization identity is required for resync"
                }))
                return

            conn_org = meta.get("organization_id")
            is_superadmin = bool(meta.get("is_superadmin", False))
            logger.info(f"Client requested authoritative resync [org={conn_org}, superadmin={is_superadmin}].")
            db = SessionLocal()
            try:
                snapshot = build_initial_snapshot(
                    db,
                    organization_id=conn_org,
                    is_superadmin=is_superadmin,
                )
                await websocket.send_text(json.dumps(snapshot, default=str))
            except Exception as e:
                logger.error(f"Error handling resync: {e}")
                await websocket.send_text(json.dumps({
                    "message_type": "error",
                    "code": "SERVER_ERROR",
                    "detail": "Failed to generate resync snapshot"
                }))
            finally:
                db.close()

        elif action == "replay":
            meta = self.connection_metadata.get(websocket)
            if not meta or (not meta.get("is_superadmin") and not meta.get("organization_id")):
                logger.warning("Rejecting replay: Connection lacks verified tenant organization identity (fail-closed)")
                await websocket.send_text(json.dumps({
                    "message_type": "error",
                    "code": "FORBIDDEN",
                    "detail": "Tenant organization identity is required for event replay"
                }))
                return

            conn_org = meta.get("organization_id")
            is_superadmin = bool(meta.get("is_superadmin", False))

            last_seq = msg.get("last_sequence_id")
            if last_seq is None:
                last_seq = payload.get("last_sequence_id", 0)

            try:
                last_seq_int = int(last_seq)
            except (ValueError, TypeError):
                logger.warning(f"Invalid last_sequence_id received: {last_seq}")
                await websocket.send_text(json.dumps({
                    "message_type": "error",
                    "code": "BAD_REQUEST",
                    "detail": "Invalid last_sequence_id format"
                }))
                return

            logger.info(f"Client requested event replay after sequence_id: {last_seq_int} [org={conn_org}, superadmin={is_superadmin}]")
            db = SessionLocal()
            try:
                missed_events = get_events_after(
                    db=db,
                    last_sequence_id=last_seq_int,
                    limit=100,
                    organization_id=conn_org,
                    is_superadmin=is_superadmin,
                )
                for ev in missed_events:
                    env = ev.to_envelope()
                    ev_org = env.get("organization_id") or env.get("payload", {}).get("organization_id")

                    # Defense in depth: Verify event ownership before transmission
                    if not is_superadmin and ev_org != conn_org:
                        logger.error(
                            f"SECURITY ALERT: Suppressed cross-tenant replay leak attempt "
                            f"(event_id={ev.id}, event_org={ev_org}, conn_org={conn_org})"
                        )
                        continue
                    elif is_superadmin and conn_org and ev_org != conn_org:
                        continue

                    await websocket.send_text(json.dumps({
                        "message_type": "event",
                        "event": env,
                        "type": env.get("event_type"),
                        "data": env.get("payload", {}),
                    }, default=str))
            except Exception as e:
                logger.error(f"Error handling event replay: {e}")
                await websocket.send_text(json.dumps({
                    "message_type": "error",
                    "code": "SERVER_ERROR",
                    "detail": "Failed to replay events"
                }))
            finally:
                db.close()

        else:
            logger.debug(f"Received unrecognized client action: '{action}'")

ws_manager = WebSocketManager()
