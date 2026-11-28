import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_tavily import TavilySearch

app = FastAPI(title="TravelMate AI")

BASE_DIR = Path(__file__).resolve().parent

# Check API keys
if not os.getenv("GOOGLE_API_KEY"):
    raise RuntimeError("Google API key is missing")

if not os.getenv("TAVILY_API_KEY"):
    raise RuntimeError("Tavily API key is missing")

# Initialize Google Gemini
model = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash-lite",
    timeout=60,
    max_retries=1
)

# Web search tool
search_tool = TavilySearch(
    max_results=3,
    search_depth="basic",
    include_raw_content=False
)

# Budget calculation tool
@tool
def calculate_budget(
    budget: float,
    transportation: float,
    accommodation: float,
    food: float,
    sightseeing: float,
    local_transport: float,
    contingency: float = 0
) -> dict:
    """Calculate total group travel costs and remaining budget in one currency."""
    costs = [
        transportation, accommodation, food,
        sightseeing, local_transport, contingency
    ]

    if budget < 0 or any(cost < 0 for cost in costs):
        return {"error": "Amounts cannot be negative"}

    total = round(sum(costs), 2)

    return {
        "budget": budget,
        "total_expenses": total,
        "remaining_budget": round(budget - total, 2),
        "within_budget": total <= budget
    }


# TravelMate instructions
SYSTEM_PROMPT = """
You are TravelMate AI, the intelligent travel
planning assistant for Tripzy.

Your responsibilities:
1. Understand travel requirements and preferences.
2. Compare flights, trains and buses.
3. Research hotels and accommodation.
4. Discover tourist attractions.
5. Generate personalized itineraries.
6. Optimize travel expenses.
7. Remember the supplied conversation context.
8. Adjust plans when user requirements change.

Use Tavily for current travel research.
Use calculate_budget for accurate budget calculations.

Avoid unnecessary or repeated web searches.
For simple questions, answer directly.

Provide source URLs for researched information.
Never invent prices or availability.
Clearly distinguish estimates from verified facts.
Do not perform actual bookings or payments.

Use headings, tables and structured responses
where appropriate.
"""

# Create LangChain agent
agent = create_agent(
    model=model,
    tools=[search_tool, calculate_budget],
    system_prompt=SYSTEM_PROMPT
)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=6000)
    history: list[dict] = Field(default_factory=list)


# Health check
@app.get("/api/health")
def health():
    return {"status": "TravelMate AI is running"}


# Chat endpoint
@app.post("/api/chat")
def chat(request: ChatRequest):
    try:
        messages = []

        for item in request.history[-12:]:
            role = item.get("role")
            content = item.get("content")

            if role in ("user", "assistant") and isinstance(content, str):
                messages.append({
                    "role": role,
                    "content": content[:6000]
                })

        messages.append({
            "role": "user",
            "content": request.message
        })

        result = agent.invoke(
            {"messages": messages},
            config={"recursion_limit": 16}
        )

        reply = result["messages"][-1].text

        return {"reply": reply}

    except Exception as error:
        print(type(error).__name__)
        raise HTTPException(
            status_code=502,
            detail="TravelMate could not generate a response."
        )


# Serve existing frontend assets
for folder in ("css", "js", "assets"):
    app.mount(
        f"/{folder}",
        StaticFiles(directory=BASE_DIR / folder),
        name=folder
    )


# Serve homepage
@app.get("/")
def homepage():
    return FileResponse(BASE_DIR / "html" / "index.html")


# Serve all website pages
@app.get("/{page}.html")
def website_page(page: str):
    allowed_pages = {
    "index",
    "chatbot",
    "explore",
    "hotels",
    "guides",
    "about",
    "contact",
    "trip-planner",
    "guide-profile",
    "travle",
    "404"
}

    if page not in allowed_pages:
        raise HTTPException(status_code=404)

    file = BASE_DIR / "html" / f"{page}.html"

    if not file.is_file():
        raise HTTPException(status_code=404)

    return FileResponse(file)



import base64
import secrets
from collections import deque
from time import monotonic
from fastapi import Request
from fastapi.responses import JSONResponse

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "")
recent_requests = deque()




@app.middleware("http")
async def protect_demo(request: Request, call_next):

    if request.url.path == "/api/chat":
        now = monotonic()

        while recent_requests and now - recent_requests[0] >= 60:
            recent_requests.popleft()

        if len(recent_requests) >= 6:
            return JSONResponse(
                {"detail": "Too many requests. Please try again shortly."},
                status_code=429
            )

        recent_requests.append(now)

    return await call_next(request)
