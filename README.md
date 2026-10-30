# 🏢 AI AGENCY — AUTONOMOUS BUSINESS HEADQUARTERS

> **An interactive 3D Corporate Headquarters where users orchestrate genuine, stateful autonomous AI agents across 8 real corporate departments with real tool execution, subprocess sandboxing, and Executive Board sign-off workflows.**

---

## 🌟 Executive Overview

**AI Agency — Autonomous Business Headquarters** is a production-grade, stateful multi-agent corporate platform. Operating on Level 42 of a modern corporate executive tower, 8 autonomous AI departments collaborate to execute real-world business objectives, perform automated software engineering in sandbox isolation, conduct market research, manage B2B sales pipelines, balance financial ledgers, and provide 24/7 customer success support.

---

## 🏛️ Autonomous Corporate Leadership & Departments

| Department | Agent ID | Leader | Role | Station ID | Color |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Executive Management** | `agent-exec-ceo` | **Victoria Vance** | Chief Executive Officer & Strategy Lead | `executive_suite` | `#3b82f6` |
| **Engineering & Architecture** | `agent-eng-lead` | **David Chen** | Principal Systems Architect & Lead Engineer | `engineering_bay` | `#0ea5e9` |
| **AI Research & Intelligence** | `agent-research-ai` | **Dr. Elena Rostova** | Chief AI Scientist & Intelligence Director | `research_lab` | `#8b5cf6` |
| **Marketing & Growth** | `agent-mkt-growth` | **Sophia Martinez** | VP of Brand Strategy & Growth Marketing | `marketing_studio` | `#f43f5e` |
| **Sales & Enterprise Solutions** | `agent-sales-director` | **Marcus Reynolds** | Director of Enterprise Solutions & Sales | `sales_wing` | `#10b981` |
| **Finance & Treasury** | `agent-fin-controller` | **Julian Thorne** | Chief Financial Officer & Treasury Controller | `finance_office` | `#eab308` |
| **Operations & Recruitment** | `agent-ops-recruiter` | **Amara Okafor** | Head of Operations & AI Agent Recruitment | `operations_hub` | `#06b6d4` |
| **Customer Success & Support** | `agent-support-lead` | **Liam O'Connor** | Head of Customer Success & Support | `support_lounge` | `#14b8a6` |

---

## 🏢 Interactive 3D Corporate Architecture

1. **Luxury Open-Plan Corporate Office**:
   - Built with **Three.js**, **React Three Fiber (R3F)**, and **Drei**.
   - Terrazzo and light oak hardwood floors with subtle reflective properties.
   - Floor-to-ceiling glass curtain walls overlooking a bustling modern metropolis skyline.
   - Acoustic ceiling baffles with recessed linear LED lighting tracks.
   - Architectural indoor greenery including planter boxes with fiddle-leaf figs and vertical living moss walls.
   - Glass-enclosed Executive Boardroom with Calacatta Gold oval marble conference table and wall-mounted ultra-wide KPI dashboard.

2. **Stylized Professional 3D AI Employees**:
   - Tailored business attire with department color identity accents.
   - Dynamic posture states: Natural breathing idle, focused multi-monitor typing, thinking neural halos, and executive authorization beacons.
   - Floating interactive status cards with name, title, department, and live task badge.

3. **Smooth Orbit Camera & Department Bookmarks**:
   - Instant smooth glide transitions to Executive Boardroom, Engineering Bay, Research Lab, Marketing Studio, Sales Wing, Finance Office, Operations Hub, and Support Lounge.

---

## ⚡ Core Technical Stack

- **Backend**: FastAPI (Python 3.9+ async engine) with SQLAlchemy 2.0 ORM and Alembic migrations.
- **Database**: SQLite (`agency.db`) with enforced foreign key integrity (`PRAGMA foreign_keys = ON;`).
- **Realtime**: Bidirectional WebSockets (`/api/v1/events/ws`) with monotonic event sequencing, snapshots, and cursor-based replay.
- **Security & Sandbox**: Restricted execution in `/workspace_sandbox` with path traversal guards, subprocess timeout limits, and AST arithmetic safety.
- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Three.js, React Three Fiber, and Zustand state store.

---

## 🚀 Getting Started

### 1. Backend Setup
```bash
# Navigate to project root
cd /Users/thienduc/Desktop/Code/provipagent

# Activate virtual environment
source backend/venv/bin/activate

# Seed corporate database
python backend/app/scripts/seed.py

# Start FastAPI server
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend Setup
```bash
# Navigate to frontend
cd frontend

# Install dependencies (if needed)
npm install

# Start development server
npm run dev
# or run production build
npm run build
```

---

## 🔒 Executive Board Approval Workflow

Any high-risk tool request (such as production code execution, shell commands, or financial transactions exceeding budget limits) automatically halts the task into `waiting_approval`.
An **Executive Board Authorization Modal** is presented to the user with full code payload inspection. The user can **AUTHORIZE & EXECUTE IN SANDBOX** or **VETO & CANCEL**. All decisions are audited in the database with conflict prevention (`409 Conflict` on duplicates).
