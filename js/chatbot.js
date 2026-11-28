"use strict";

const byId = (id) => document.getElementById(id);
const form = byId("chat-form");
const input = byId("message");
const sendButton = byId("send-message");
const transcript = byId("chat-messages");
const scrollPane = byId("chat-scroll");
const feedback = byId("chat-feedback");
const historyPanel = byId("history-panel");
const historyList = byId("chat-history");
const clearHistory = byId("clear-history");
const compact = matchMedia("(max-width: 720px)");
const endpointSetting = (document.body.dataset.chatEndpoint ?? "").trim();
const endpoint = getEndpoint(endpointSetting);
const storageKey = "tripzy.travelmate.v1." + (endpoint?.pathname ?? "demo");
const maxChats = 12;
const maxMessages = 30;
const maxReply = 16000;
const waiting = new Set();
let chats = loadChats();
let activeId = chats[0]?.id;
let storageAvailable = true;

function getEndpoint(setting) {
    if (!setting) return null;

    try {
        const url = new URL(setting, location.href);
        if (["http:", "https:"].includes(url.protocol) && url.origin === location.origin &&
            !url.username && !url.password && !url.hash && !url.search) {
            return url;
        }
    } catch {
        // The page reports the configuration issue beside the composer.
    }
    return null;
}

function loadChats() {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        return saved.slice(0, maxChats).filter((chat) =>
            typeof chat.id === "string" && typeof chat.title === "string" &&
            Array.isArray(chat.messages) && chat.messages.every(({ role, text }) =>
                ["user", "assistant", "error"].includes(role) && typeof text === "string"
            )
        );
    } catch {
        return [];
    }
}

function saveChats() {
    try {
        if (chats.length) localStorage.setItem(storageKey, JSON.stringify(chats));
        else localStorage.removeItem(storageKey);
        storageAvailable = true;
    } catch {
        storageAvailable = false;
    }

    const modeNote = endpoint
        ? "Messages are sent to TravelMate."
        : "Demo replies are sample answers.";
    const historyNote = storageAvailable
        ? "Chat history is saved in this browser when storage is available."
        : "Browser storage is unavailable. Chat history is kept while this page is open.";
    byId("chat-note").textContent = endpointSetting && !endpoint
        ? "Serve this page over HTTP or HTTPS and configure a chat endpoint on the same site."
        : modeNote + " " + historyNote;
}

function renderHistory() {
    historyList.replaceChildren();
    byId("empty-history").hidden = chats.length > 0;
    clearHistory.hidden = chats.length === 0;
    clearHistory.disabled = waiting.size > 0;

    for (const chat of chats) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const label = document.createElement("span");
        button.type = "button";
        button.append(historyListIcon(), label);
        label.textContent = chat.title;
        if (chat.id === activeId) button.setAttribute("aria-current", "true");
        button.addEventListener("click", () => selectChat(chat.id));
        item.append(button);
        historyList.append(item);
    }
}

function historyListIcon() {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    const use = document.createElementNS(namespace, "use");
    icon.setAttribute("aria-hidden", "true");
    use.setAttribute("href", "#tm-message-icon");
    icon.append(use);
    return icon;
}

function appendInline(parent, text) {
    const tokens = /\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
    let position = 0;

    for (const match of text.matchAll(tokens)) {
        parent.append(text.slice(position, match.index));
        if (match[1]) {
            let href;
            try {
                const parsed = new URL(match[2]);
                if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
                    href = parsed.href;
                }
            } catch {
                // Relative and malformed links are displayed as text.
            }
            if (href) {
                const link = document.createElement("a");
                link.href = href;
                link.textContent = match[1];
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                parent.append(link);
            } else {
                parent.append(match[0]);
            }
        } else {
            const inline = document.createElement(match[3] ? "strong" : "code");
            inline.textContent = match[3] ?? match[4];
            parent.append(inline);
        }
        position = match.index + match[0].length;
    }

    parent.append(text.slice(position));
}

function appendMarkdown(parent, text) {
    let list;
    let paragraph;

    for (const line of text.split(/\r?\n/)) {
        const heading = /^#{1,6}\s+(.+)$/.exec(line);
        const bullet = /^\s*([-*]|\d+[.)])\s+(.+)$/.exec(line);

        if (bullet) {
            paragraph = null;
            const kind = /^\d/.test(bullet[1]) ? "ol" : "ul";
            if (list?.localName !== kind) {
                list = document.createElement(kind);
                parent.append(list);
            }
            const item = document.createElement("li");
            appendInline(item, bullet[2]);
            list.append(item);
            continue;
        }

        list = null;
        if (heading) {
            paragraph = null;
            const title = document.createElement("h2");
            appendInline(title, heading[1]);
            parent.append(title);
        } else if (line.trim()) {
            if (paragraph) {
                paragraph.append(document.createElement("br"));
            } else {
                paragraph = document.createElement("p");
                parent.append(paragraph);
            }
            appendInline(paragraph, line);
        } else {
            paragraph = null;
        }
    }
}

function renderChat() {
    const messages = chats.find(({ id }) => id === activeId)?.messages ?? [];
    byId("chat-welcome").hidden = messages.length > 0;
    transcript.hidden = messages.length === 0;
    transcript.replaceChildren();

    for (const { role, text } of messages) {
        const item = document.createElement("li");
        const bubble = document.createElement("div");
        const speaker = document.createElement("span");
        item.className = "tm-message";
        item.dataset.role = role;
        speaker.className = "tm-speaker";
        speaker.textContent = role === "user" ? "You" : role === "error" ? "Message status" : "TravelMate";
        bubble.append(speaker);

        if (role === "assistant") appendMarkdown(bubble, text);
        else bubble.append(text);

        item.append(bubble);
        transcript.append(item);
    }
    scrollPane.scrollTop = messages.length ? scrollPane.scrollHeight : 0;
}

function updateComposer() {
    sendButton.disabled = Boolean(endpointSetting && !endpoint) || waiting.size > 0 || !input.value.trim();
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
}

function setFeedback(message = "", busy = false) {
    feedback.textContent = message;
    feedback.toggleAttribute("data-busy", busy);
}

function pendingFeedback() {
    if (!waiting.size) return setFeedback();
    if (!waiting.has(activeId)) return setFeedback("A reply is in progress in another chat.", true);
    const message = endpoint ? "TravelMate is working. Travel research can take a few minutes." : "Preparing a sample reply…";
    setFeedback(message, true);
}

function selectChat(id) {
    activeId = id;
    input.value = "";
    if (compact.matches) historyPanel.open = false;
    renderHistory();
    renderChat();
    pendingFeedback();
    updateComposer();
    input.focus({ preventScroll: true });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function demoReply(text) {
    await delay(420);

    if (/budget|₹|cost|expense/i.test(text) && !/stays?|hotels?|homestays?/i.test(text)) {
        return "## Sample budget for three travellers\n- Intercity transport: ₹12,000\n- Accommodation: ₹8,000\n- Meals: ₹6,000\n- Local travel and activities: ₹5,000\n- Buffer: ₹4,000\n\n**Total: ₹35,000.** These are example allocations. Live prices depend on your dates and group.";
    }
    if (/stays?|hotels?|homestays?|rooms?|accommodation/i.test(text)) {
        return "## Shortlisting a stay in Manali\n- Check the final price for three guests, including an extra bed and taxes.\n- Compare a central stay near Mall Road with a guesthouse in Old Manali.\n- For an ₹8,000 cap over three nights, aim for about ₹2,666 per night all in.\n\nShare your check-in dates and preferred area to refine the shortlist in agent mode.";
    }
    if (/sightsee|itinerary|attractions?|visit|one.day/i.test(text)) {
        return "## One day in Manali\n1. **Morning:** Start at Hadimba Devi Temple and leave time for a walk through the cedar grove.\n2. **Afternoon:** Head to Old Manali for lunch and explore the nearby lanes.\n3. **Evening:** Walk around Mall Road and stop for dinner.\n\nCheck opening hours and local conditions before you travel.";
    }
    if (/transport|train|bus|route|flight/i.test(text)) {
        return "## Ahmedabad to Manali\n- **Train and road:** Compare trains from Ahmedabad to Chandigarh, then look for a bus or shared cab to Manali. Allow extra time between connections.\n- **Bus route:** Compare buses via Delhi or Chandigarh, including an overnight leg to Manali.\n\nCheck schedules and fares for your travel dates before choosing a route.";
    }
    return "Start with your **destination**, **travel dates**, **group size** and **budget**. This demo can show sample replies about transport, stays, sightseeing and budgeting.";
}

async function agentReply(message, conversationId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8 * 60 * 1000);
    const options = {
        signal: controller.signal,
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store"
    };

    try {
        let response = await fetch(endpoint, {
            ...options,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, conversationId })
        });

        if (response.status === 202) {
            const { jobId } = await response.json();
            if (typeof jobId !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(jobId)) {
                throw new Error("Invalid job ID.");
            }
            const statusUrl = new URL(endpoint);
            statusUrl.searchParams.set("jobId", jobId);
            while (response.status === 202) {
                await delay(2500);
                response = await fetch(statusUrl, options);
            }
        }

        if (!response.ok) throw new Error("TravelMate request failed.");
        const { reply } = await response.json();
        if (typeof reply !== "string" || !reply.trim()) throw new Error("Empty TravelMate reply.");

        return reply.length > maxReply ? reply.slice(0, maxReply) + "\n\n[Reply shortened]" : reply;
    } finally {
        clearTimeout(timer);
    }
}

async function sendMessage(event) {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || sendButton.disabled) return;

    let chat = chats.find(({ id }) => id === activeId);
    if (!chat) {
        const title = message.replace(/\s+/g, " ");
        chat = {
            id: crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
                byte.toString(16).padStart(2, "0")
            ).join(""),
            title: title.length > 60 ? title.slice(0, 59) + "…" : title,
            messages: []
        };
        activeId = chat.id;
    }

    chat.messages = [...chat.messages, { role: "user", text: message }].slice(1 - maxMessages);
    waiting.add(chat.id);
    chats = [chat, ...chats.filter(({ id }) => id !== chat.id)].slice(0, maxChats);

    input.value = "";
    saveChats();
    renderHistory();
    renderChat();
    pendingFeedback();
    updateComposer();
    input.focus({ preventScroll: true });

    try {
        const reply = endpoint ? await agentReply(message, chat.id) : await demoReply(message);
        chat.messages.push({ role: "assistant", text: reply });
    } catch (error) {
        const text = error.name === "AbortError"
            ? "TravelMate took too long to reply. Wait a moment before trying again."
            : "TravelMate could not reply. Try again in a moment.";
        chat.messages.push({ role: "error", text });
    } finally {
        waiting.delete(chat.id);
        saveChats();
        clearHistory.disabled = waiting.size > 0;
        if (activeId === chat.id) {
            renderChat();
            const lastMessage = chat.messages.at(-1);
            setFeedback(lastMessage.role === "error" ? lastMessage.text : "TravelMate replied.");
        } else {
            setFeedback();
        }
        updateComposer();
    }
}

form.addEventListener("submit", sendMessage);
input.addEventListener("input", updateComposer);
input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (!sendButton.disabled) form.requestSubmit();
    }
});

for (const prompt of document.querySelectorAll("[data-prompt]")) {
    prompt.addEventListener("click", () => {
        input.value = prompt.dataset.prompt;
        updateComposer();
        input.focus({ preventScroll: true });
    });
}

byId("new-chat").addEventListener("click", () => selectChat(undefined));
clearHistory.addEventListener("click", () => {
    if (!confirm("Clear TravelMate chat history from this browser?")) return;
    chats = [];
    saveChats();
    selectChat(undefined);
});

if (endpoint) {
    const mode = byId("chat-mode");
    mode.textContent = "Agent mode";
    mode.setAttribute("data-connected", "");
} else if (endpointSetting) {
    byId("chat-mode").textContent = "Setup needed";
}
historyPanel.open = !compact.matches;
compact.addEventListener("change", ({ matches }) => { historyPanel.open = !matches; });
saveChats();
renderHistory();
renderChat();
updateComposer();
