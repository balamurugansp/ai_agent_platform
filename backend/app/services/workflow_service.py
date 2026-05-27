"""
Workflow service — CRUD + pre-built template seeding.

Pre-built templates:
  1. Content Creation Pipeline  — 3-agent chain: Researcher → Writer → Editor
  2. Log Analysis Team          — 3-agent router: Classifier → AnalyserA/B
"""
import logging
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.workflow import Workflow
from app.models.agent import Agent

logger = logging.getLogger(__name__)

# ─── Template definitions ─────────────────────────────────────────────────────

CONTENT_PIPELINE_AGENTS = [
    {
        "name": "Content Researcher",
        "role": "researcher",
        "system_prompt": (
            "You are an expert content researcher. Given a topic, search the web "
            "and compile a comprehensive research brief with key facts, statistics, "
            "trends, and authoritative sources. Output a structured brief."
        ),
        "model": "gpt-4o-mini",
        "tools": ["web_search"],
        "memory_type": "sliding_window",
        "memory_window": 8,
        "skills": ["deep-research", "fact-checking", "source-evaluation"],
    },
    {
        "name": "Content Writer",
        "role": "writer",
        "system_prompt": (
            "You are a professional content writer. Using the research brief provided, "
            "write a high-quality, engaging article with clear structure: introduction, "
            "body (3-5 sections), and conclusion. Match the requested tone and length. "
            "When finished, output 'WRITING_COMPLETE' on a new line."
        ),
        "model": "gpt-4o-mini",
        "tools": [],
        "memory_type": "sliding_window",
        "memory_window": 10,
        "skills": ["SEO-optimized writing", "storytelling", "clear communication"],
    },
    {
        "name": "Content Editor",
        "role": "editor",
        "system_prompt": (
            "You are a senior content editor. Review the draft article for clarity, "
            "grammar, structure, tone consistency, and factual accuracy. Provide an "
            "edited final version with inline comments on major changes. "
            "End with 'EDITORIAL_REVIEW_COMPLETE' and a quality score (1-10)."
        ),
        "model": "gpt-4o-mini",
        "tools": [],
        "memory_type": "summary",
        "memory_window": 6,
        "skills": ["copy editing", "style guide enforcement", "quality assessment"],
    },
]

LOG_ANALYSIS_AGENTS = [
    {
        "name": "Log Classifier",
        "role": "classifier",
        "system_prompt": (
            "You are a log classification specialist. Analyze incoming log data and "
            "classify the issue type. Respond with a JSON object: "
            '{"type": "performance|security|error|warning", "severity": "critical|high|medium|low", '
            '"summary": "brief description"}. Nothing else.'
        ),
        "model": "gpt-4o-mini",
        "tools": [],
        "memory_type": "sliding_window",
        "memory_window": 5,
        "skills": ["log pattern recognition", "anomaly detection"],
    },
    {
        "name": "Performance Analyst",
        "role": "analyst",
        "system_prompt": (
            "You are a performance engineering specialist. Analyse performance-related "
            "log entries to identify bottlenecks, memory leaks, slow queries, or "
            "resource exhaustion. Provide a root-cause analysis and remediation steps. "
            "End with 'PERFORMANCE_ANALYSIS_COMPLETE'."
        ),
        "model": "gpt-4o-mini",
        "tools": ["web_search"],
        "memory_type": "sliding_window",
        "memory_window": 8,
        "skills": ["APM", "database tuning", "profiling"],
    },
    {
        "name": "Security Analyst",
        "role": "analyst",
        "system_prompt": (
            "You are a cybersecurity analyst. Analyse security-related log entries "
            "for threats: intrusion attempts, privilege escalation, data exfiltration, "
            "or authentication anomalies. Provide a threat assessment, CVSS score estimate, "
            "and immediate mitigation steps. End with 'SECURITY_ANALYSIS_COMPLETE'."
        ),
        "model": "gpt-4o-mini",
        "tools": ["web_search"],
        "memory_type": "sliding_window",
        "memory_window": 8,
        "skills": ["SIEM", "threat intelligence", "incident response"],
    },
]


def _id() -> str:
    return str(uuid.uuid4())


def _content_pipeline_template(agent_ids: list[str]) -> dict:
    """Build Content Creation Pipeline workflow nodes/edges."""
    r_id, w_id, e_id = [_id() for _ in range(3)]
    return {
        "nodes": [
            {"id": r_id, "type": "agent", "agent_id": agent_ids[0],
             "position": {"x": 100, "y": 200},
             "data": {"label": "Researcher", "color": "#4472c4"}},
            {"id": w_id, "type": "agent", "agent_id": agent_ids[1],
             "position": {"x": 420, "y": 200},
             "data": {"label": "Writer", "color": "#375623"}},
            {"id": e_id, "type": "agent", "agent_id": agent_ids[2],
             "position": {"x": 740, "y": 200},
             "data": {"label": "Editor", "color": "#7030a0"}},
        ],
        "edges": [
            {"id": _id(), "source": r_id, "target": w_id, "condition": "",
             "label": "research brief →"},
            {"id": _id(), "source": w_id, "target": e_id,
             "condition": "contains:WRITING_COMPLETE",
             "label": "draft →"},
        ],
        "entry_point": r_id,
    }


def _log_analysis_template(agent_ids: list[str]) -> dict:
    """Build Log Analysis Team workflow with router node."""
    cl_id  = _id()
    rt_id  = _id()
    pa_id  = _id()
    sa_id  = _id()
    return {
        "nodes": [
            {"id": cl_id, "type": "agent", "agent_id": agent_ids[0],
             "position": {"x": 100, "y": 200},
             "data": {"label": "Classifier", "color": "#c55a11"}},
            {"id": rt_id, "type": "router", "agent_id": None,
             "position": {"x": 380, "y": 200},
             "data": {"label": "Router", "color": "#888888",
                      "routes": ["performance", "security"]}},
            {"id": pa_id, "type": "agent", "agent_id": agent_ids[1],
             "position": {"x": 660, "y": 100},
             "data": {"label": "Perf Analyst", "color": "#0078d4"}},
            {"id": sa_id, "type": "agent", "agent_id": agent_ids[2],
             "position": {"x": 660, "y": 300},
             "data": {"label": "Sec Analyst", "color": "#b85450"}},
        ],
        "edges": [
            {"id": _id(), "source": cl_id, "target": rt_id, "condition": "", "label": "classify →"},
            {"id": _id(), "source": rt_id, "target": pa_id,
             "condition": 'contains:"type": "performance"', "label": "performance"},
            {"id": _id(), "source": rt_id, "target": sa_id,
             "condition": 'contains:"type": "security"', "label": "security"},
        ],
        "entry_point": cl_id,
    }


# ─── Seed function ────────────────────────────────────────────────────────────

async def seed_templates() -> None:
    async with async_session_factory() as session:
        # Check if already seeded
        existing = await session.execute(
            select(Workflow).where(Workflow.template_name.in_([
                "content_creation_pipeline", "log_analysis_team"
            ]))
        )
        if existing.scalars().first():
            return

        logger.info("Seeding built-in workflow templates...")

        # ── Content Creation Pipeline ──────────────────────────────────────
        content_agents = []
        for cfg in CONTENT_PIPELINE_AGENTS:
            agent = Agent(**cfg)
            session.add(agent)
            content_agents.append(agent)
        await session.flush()

        tpl1 = _content_pipeline_template([a.id for a in content_agents])
        wf1 = Workflow(
            name="Content Creation Pipeline",
            description=(
                "Three-agent sequential chain: Researcher gathers facts → "
                "Writer produces a draft → Editor refines and quality-scores the output."
            ),
            nodes=tpl1["nodes"],
            edges=tpl1["edges"],
            entry_point=tpl1["entry_point"],
            template_name="content_creation_pipeline",
        )
        session.add(wf1)

        # ── Log Analysis Team ───────────────────────────────────────────────
        log_agents = []
        for cfg in LOG_ANALYSIS_AGENTS:
            agent = Agent(**cfg)
            session.add(agent)
            log_agents.append(agent)
        await session.flush()

        tpl2 = _log_analysis_template([a.id for a in log_agents])
        wf2 = Workflow(
            name="Log Analysis Team",
            description=(
                "Classifier categorises log entries → Router dispatches to specialised "
                "Performance or Security Analyst depending on issue type."
            ),
            nodes=tpl2["nodes"],
            edges=tpl2["edges"],
            entry_point=tpl2["entry_point"],
            template_name="log_analysis_team",
        )
        session.add(wf2)

        await session.commit()
        logger.info("Templates seeded: Content Creation Pipeline, Log Analysis Team")
