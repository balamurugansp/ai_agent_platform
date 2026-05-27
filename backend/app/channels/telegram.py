"""
Telegram bot integration.

Flow:
  1. User sends message to bot.
  2. Bot looks up which workflow is connected to Telegram (agents with
     channel config {"channel": "telegram"}).
  3. If found, creates a WorkflowRun and executes it.
  4. Sends the final output back to the user.
  5. Full conversation history is persisted as RunMessages.

To enable: set TELEGRAM_BOT_TOKEN in .env and add a Telegram channel
to at least one agent that belongs to a workflow.
"""
import asyncio
import logging
from typing import Optional

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

from app.core.config import settings
from app.core.events import event_bus

logger = logging.getLogger(__name__)


class TelegramBot:
    def __init__(self):
        self.app: Optional[Application] = None
        self._running = False

    async def start(self):
        if not settings.TELEGRAM_BOT_TOKEN:
            logger.info("No TELEGRAM_BOT_TOKEN set — bot disabled.")
            return

        self.app = (
            Application.builder()
            .token(settings.TELEGRAM_BOT_TOKEN)
            .build()
        )

        self.app.add_handler(CommandHandler("start", self._cmd_start))
        self.app.add_handler(CommandHandler("help", self._cmd_help))
        self.app.add_handler(CommandHandler("status", self._cmd_status))
        self.app.add_handler(
            MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_message)
        )

        self._running = True
        logger.info("Telegram bot polling started.")
        async with self.app:
            await self.app.start()
            await self.app.updater.start_polling(drop_pending_updates=True)
            # Keep running until cancelled
            while self._running:
                await asyncio.sleep(1)
            await self.app.updater.stop()
            await self.app.stop()

    async def stop(self):
        self._running = False

    # ─── Command handlers ──────────────────────────────────────────────────

    async def _cmd_start(self, update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "👋 Welcome to *Yuno AI Agent Platform*!\n\n"
            "Just send me a message and I'll route it to the configured AI agent workflow.\n\n"
            "Commands:\n"
            "/start — this message\n"
            "/help  — usage guide\n"
            "/status — check connected workflow",
            parse_mode="Markdown",
        )

    async def _cmd_help(self, update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "💡 *How to use:*\n\n"
            "1. Send any text message.\n"
            "2. The AI agent will process your request.\n"
            "3. You'll receive the response when ready.\n\n"
            "_Powered by Yuno AI Agent Orchestration Platform_",
            parse_mode="Markdown",
        )

    async def _cmd_status(self, update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        workflow = await self._find_connected_workflow()
        if workflow:
            await update.message.reply_text(
                f"✅ Connected to workflow: *{workflow['name']}*\n"
                f"_{workflow['description']}_",
                parse_mode="Markdown",
            )
        else:
            await update.message.reply_text(
                "⚠️ No workflow connected to Telegram yet.\n"
                "Add a Telegram channel to an agent in the web UI.",
            )

    # ─── Message handler ───────────────────────────────────────────────────

    async def _handle_message(self, update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        user_text = update.message.text
        chat_id = str(update.effective_chat.id)
        user_name = update.effective_user.full_name if update.effective_user else "User"

        logger.info("Telegram message from %s (%s): %s", user_name, chat_id, user_text[:80])

        # Acknowledge receipt
        thinking_msg = await update.message.reply_text("🤔 Processing your request...")

        try:
            workflow = await self._find_connected_workflow()
            if not workflow:
                await thinking_msg.edit_text(
                    "⚠️ No workflow is connected to Telegram. "
                    "Please configure one in the web UI."
                )
                return

            # Run the workflow
            output = await self._execute_workflow(
                workflow=workflow,
                message=user_text,
                chat_id=chat_id,
            )

            await thinking_msg.edit_text(output)

        except Exception as exc:
            logger.error("Telegram handler error: %s", exc, exc_info=True)
            await thinking_msg.edit_text(
                f"❌ An error occurred: {str(exc)[:200]}"
            )

    # ─── Workflow execution ────────────────────────────────────────────────

    async def _find_connected_workflow(self) -> Optional[dict]:
        """Find the first workflow whose entry agent has a Telegram channel config."""
        from app.core.database import AsyncSessionLocal
        from app.models.workflow import Workflow
        from app.models.agent import Agent
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Workflow).where(Workflow.is_active == True)
            )
            workflows = result.scalars().all()

            for wf in workflows:
                nodes = wf.nodes or []
                for node in nodes:
                    agent_id = node.get("agent_id")
                    if not agent_id:
                        continue
                    agent_result = await db.execute(
                        select(Agent).where(Agent.id == agent_id)
                    )
                    agent = agent_result.scalar_one_or_none()
                    if agent and agent.channels:
                        for ch in agent.channels:
                            if isinstance(ch, dict) and ch.get("channel") == "telegram":
                                return {
                                    "id": wf.id,
                                    "name": wf.name,
                                    "description": wf.description,
                                    "nodes": wf.nodes,
                                    "edges": wf.edges,
                                    "entry_point": wf.entry_point,
                                }
        return None

    async def _execute_workflow(self, workflow: dict, message: str, chat_id: str) -> str:
        from app.core.database import AsyncSessionLocal
        from app.models.agent import Agent
        from app.services.workflow_service import create_run
        from app.services.run_service import finish_run
        from app.runtime.langgraph_runtime import execute_workflow
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            # Load agents
            agent_ids = [n["agent_id"] for n in workflow.get("nodes", [])]
            result = await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
            agents = {}
            for a in result.scalars().all():
                agents[a.id] = {
                    "id": a.id, "name": a.name, "role": a.role,
                    "system_prompt": a.system_prompt, "model": a.model,
                    "temperature": a.temperature, "max_tokens": a.max_tokens,
                    "tools": a.tools or [], "memory_enabled": a.memory_enabled,
                    "memory_window": a.memory_window, "skills": a.skills or [],
                }

            # Create run record
            run = await create_run(
                db,
                workflow_id=workflow["id"],
                input_message=message,
                trigger_source="telegram",
                trigger_data={"chat_id": chat_id},
            )
            run_id = run.id

        # Update status to running
        async with AsyncSessionLocal() as db:
            r = await db.get(type(run), run_id)
            if r:
                r.status = "running"
                await db.commit()

        try:
            output = await execute_workflow(
                workflow=workflow,
                agents_by_id=agents,
                run_id=run_id,
                input_message=message,
            )
            await finish_run(run_id, "completed", output)
            return output
        except Exception as exc:
            await finish_run(run_id, "failed", str(exc))
            raise

    async def send_message(self, chat_id: str, text: str):
        """Send a proactive message to a chat."""
        if self.app:
            await self.app.bot.send_message(chat_id=chat_id, text=text)


telegram_bot = TelegramBot()
