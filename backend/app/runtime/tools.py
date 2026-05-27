"""
Built-in tools available to agents.
"""
import json
import math
import httpx
from datetime import datetime
from langchain_core.tools import tool
from duckduckgo_search import DDGS


@tool
def web_search(query: str) -> str:
    """Search the web for current information. Use for facts, news, or recent events."""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
        if not results:
            return "No results found."
        formatted = []
        for r in results:
            formatted.append(f"**{r.get('title', 'No title')}**\n{r.get('body', '')}\nURL: {r.get('href', '')}")
        return "\n\n".join(formatted)
    except Exception as e:
        return f"Search failed: {str(e)}"


@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression. Example: '2 + 2', 'sqrt(16)', '10 * 3.14'."""
    try:
        # Safe eval with math functions
        allowed_names = {k: v for k, v in math.__dict__.items() if not k.startswith("_")}
        allowed_names["abs"] = abs
        result = eval(expression, {"__builtins__": {}}, allowed_names)
        return str(result)
    except Exception as e:
        return f"Calculation error: {str(e)}"


@tool
def get_current_time(timezone: str = "UTC") -> str:
    """Get the current date and time."""
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")


@tool
def http_request(url: str, method: str = "GET", body: str = "") -> str:
    """Make an HTTP request to a URL. Returns the response text (max 2000 chars)."""
    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            if method.upper() == "POST":
                resp = client.post(url, content=body)
            else:
                resp = client.get(url)
        text = resp.text[:2000]
        return f"Status: {resp.status_code}\n{text}"
    except Exception as e:
        return f"HTTP error: {str(e)}"


@tool
def summarize_text(text: str, max_sentences: int = 5) -> str:
    """Return the first N sentences of a text as a quick summary."""
    sentences = text.replace("\n", " ").split(". ")
    return ". ".join(sentences[:max_sentences]) + ("." if len(sentences) > max_sentences else "")


# Registry: tool_name → LangChain tool object
TOOL_REGISTRY = {
    "web_search": web_search,
    "calculator": calculator,
    "get_current_time": get_current_time,
    "http_request": http_request,
    "summarize_text": summarize_text,
}

TOOL_DESCRIPTIONS = {
    "web_search": "Search the web for real-time information",
    "calculator": "Evaluate math expressions",
    "get_current_time": "Get current date and time",
    "http_request": "Make HTTP GET/POST requests",
    "summarize_text": "Summarize a block of text",
}


def get_tools_for_agent(tool_names: list[str]) -> list:
    return [TOOL_REGISTRY[name] for name in tool_names if name in TOOL_REGISTRY]
