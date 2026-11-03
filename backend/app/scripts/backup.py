"""
PROVIPAGENT Production Database Backup & Restore Engine
Utilizes the SQLite Online Backup API for non-blocking, consistent snapshots.
"""

import sys
import os
import sqlite3
import argparse
import hashlib
from typing import Dict, Any, Tuple


CRITICAL_TABLES = [
    "agents",
    "organizations",
    "tasks",
    "users",
    "workstation_allocations",
    "executions",
    "terminal_lines",
    "agent_events",
    "meetings",
]


def compute_sha256(filepath: str) -> str:
    """Computes SHA-256 hash of a file."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def backup_database(
    source_path: str,
    target_path: str,
    pages_per_step: int = 250,
) -> Dict[str, Any]:
    """
    Creates a consistent point-in-time backup of SQLite database using Online Backup API.
    Does not block concurrent readers or writers. Flushes active WAL frames automatically.
    """
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"Source database not found: {source_path}")

    # Ensure target parent directory exists
    target_dir = os.path.dirname(target_path)
    if target_dir:
        os.makedirs(target_dir, exist_ok=True)

    if os.path.exists(target_path):
        os.remove(target_path)

    src_conn = sqlite3.connect(source_path)
    dst_conn = sqlite3.connect(target_path)

    try:
        # Perform online backup
        src_conn.backup(dst_conn, pages=pages_per_step)
    finally:
        dst_conn.close()
        src_conn.close()

    # Verify backup
    verification = verify_backup(source_path, target_path)
    return {
        "status": "success",
        "source_path": source_path,
        "target_path": target_path,
        "backup_size_bytes": os.path.getsize(target_path),
        "backup_sha256": compute_sha256(target_path),
        "verification": verification,
    }


def verify_backup(source_path: str, backup_path: str) -> Dict[str, Any]:
    """
    Verifies integrity, foreign keys, and table row parity on the backup database.
    """
    conn = sqlite3.connect(backup_path)
    cursor = conn.cursor()

    try:
        # 1. Integrity check
        cursor.execute("PRAGMA integrity_check;")
        integrity_status = cursor.fetchone()[0]

        # 2. Foreign key check
        cursor.execute("PRAGMA foreign_key_check;")
        fk_violations = len(cursor.fetchall())

        # 3. Table parity check
        src_conn = sqlite3.connect(source_path)
        src_cursor = src_conn.cursor()

        row_counts: Dict[str, Tuple[int, int]] = {}
        parity_match = True

        for table in CRITICAL_TABLES:
            try:
                src_cursor.execute(f"SELECT count(*) FROM {table};")
                src_cnt = src_cursor.fetchone()[0]
            except sqlite3.OperationalError:
                src_cnt = -1

            try:
                cursor.execute(f"SELECT count(*) FROM {table};")
                bak_cnt = cursor.fetchone()[0]
            except sqlite3.OperationalError:
                bak_cnt = -1

            row_counts[table] = (src_cnt, bak_cnt)
            if src_cnt != bak_cnt:
                parity_match = False

        src_conn.close()

        return {
            "integrity_check": integrity_status,
            "foreign_key_violations": fk_violations,
            "parity_match": parity_match,
            "row_counts": row_counts,
        }
    finally:
        conn.close()


def restore_database(backup_path: str, restore_target_path: str) -> Dict[str, Any]:
    """
    Restores database from backup snapshot using Online Backup API.
    """
    if not os.path.exists(backup_path):
        raise FileNotFoundError(f"Backup file not found: {backup_path}")

    return backup_database(source_path=backup_path, target_path=restore_target_path)


def main():
    parser = argparse.ArgumentParser(description="PROVIPAGENT SQLite Online Backup & Restore Utility")
    parser.add_argument("--source", default="e2e_agency.db", help="Path to source SQLite database")
    parser.add_argument("--target", required=True, help="Path to output backup file")
    parser.add_argument("--restore-to", help="Path to restore destination")
    parser.add_argument("--verify", action="store_true", help="Run comprehensive integrity validation")

    args = parser.parse_args()

    if args.restore_to:
        print(f"Restoring {args.target} -> {args.restore_to}...")
        result = restore_database(args.target, args.restore_to)
        print("Restore completed successfully.")
        print(f"Integrity: {result['verification']['integrity_check']}")
        sys.exit(0)

    print(f"Backing up {args.source} -> {args.target}...")
    result = backup_database(args.source, args.target)
    print("Backup completed successfully.")
    print(f"Size: {result['backup_size_bytes']} bytes")
    print(f"SHA-256: {result['backup_sha256']}")
    print(f"Integrity: {result['verification']['integrity_check']}")
    print(f"Foreign Key Violations: {result['verification']['foreign_key_violations']}")
    print(f"Table Row Parity Match: {result['verification']['parity_match']}")


if __name__ == "__main__":
    main()

