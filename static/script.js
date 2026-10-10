
const API = ""; // Same origin: frontend and FastAPI

const fileInput = document.getElementById("pdf-file");
const uploadTitle = document.getElementById("upload-title");
const uploadSubtitle = document.getElementById("upload-subtitle");
const uploadStatus = document.getElementById("upload-status");
const sidebarStatus = document.getElementById("sidebar-status");
const welcome = document.getElementById("welcome");
const messages = document.getElementById("chat-messages");
const questionInput = document.getElementById("question");
const sendButton = document.getElementById("send-btn");

let documentReady = false;
let busy = false;

function setStatus(message, type = "") {
    uploadStatus.textContent = message;
    uploadStatus.className = `upload-status ${type}`;
}

function showChat() {
    welcome.hidden = true;
    messages.hidden = false;
}

function addMessage(role, content, sources = []) {
    showChat();

    const message = document.createElement("div");
    message.className = `message ${role}`;

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = role === "user" ? "YOU" : "KNOWBASE AI";

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = content;

    message.append(label, body);

    if (sources.length) {
        const sourceBox = document.createElement("div");
        sourceBox.className = "sources";

        const heading = document.createElement("div");
        heading.textContent = "Retrieved sources";
        sourceBox.appendChild(heading);

        sources.forEach(source => {
            const tag = document.createElement("span");
            const page = Number.isInteger(source.page)
                ? ` · Page ${source.page + 1}`
                : "";

            tag.textContent = `${source.source || "Document"}${page}`;
            sourceBox.appendChild(tag);
        });

        message.appendChild(sourceBox);
    }

    messages.appendChild(message);
    message.scrollIntoView({ behavior: "smooth", block: "end" });

    return message;
}

async function readResponse(response) {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Request failed (${response.status})`);
    }

    return data;
}

fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
        setStatus("Please select a PDF file.", "error");
        fileInput.value = "";
        return;
    }

    if (busy) {
        setStatus("Please wait for the current request to finish.", "error");
        fileInput.value = "";
        return;
    }

    busy = true;
    sendButton.disabled = true;
    uploadTitle.textContent = file.name;
    uploadSubtitle.textContent = "Uploading and processing...";
    sidebarStatus.textContent = "Processing PDF";
    setStatus("Reading document and generating embeddings...");

    try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`${API}/upload`, {
            method: "POST",
            body: formData
        });

        const data = await readResponse(response);

        documentReady = true;
        uploadSubtitle.textContent = `${data.pages} pages · ${data.chunks} chunks`;
        sidebarStatus.textContent = "Document processed";
        setStatus("PDF processed successfully. You can now ask questions.", "success");

    } catch (error) {
        documentReady = false;
        uploadSubtitle.textContent = "Upload failed — please try again";
        sidebarStatus.textContent = "Upload failed";
        setStatus(error.message, "error");

    } finally {
        busy = false;
        sendButton.disabled = !questionInput.value.trim();
        fileInput.value = "";
    }
});

async function askQuestion(question) {
    question = question.trim();

    if (!question || busy) return;

    if (!documentReady) {
        setStatus("Upload a PDF successfully before asking questions.", "error");
        return;
    }

    busy = true;
    sendButton.disabled = true;
    questionInput.disabled = true;

    addMessage("user", question);

    const typing = addMessage("assistant", "Thinking...");
    typing.querySelector(".message-body").classList.add("typing");

    try {
        const response = await fetch(`${API}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question })
        });

        const data = await readResponse(response);

        typing.querySelector(".message-body").textContent = data.answer;

        if (data.sources?.length) {
            const sourceBox = document.createElement("div");
            sourceBox.className = "sources";

            const heading = document.createElement("div");
            heading.textContent = "Retrieved sources";
            sourceBox.appendChild(heading);

            data.sources.forEach(source => {
                const tag = document.createElement("span");
                const page = Number.isInteger(source.page)
                    ? ` · Page ${source.page + 1}`
                    : "";
                tag.textContent = `${source.source || "Document"}${page}`;
                sourceBox.appendChild(tag);
            });

            typing.appendChild(sourceBox);
        }

    } catch (error) {
        typing.querySelector(".message-body").textContent =
            `Sorry, something went wrong: ${error.message}`;

    } finally {
        busy = false;
        questionInput.disabled = false;
        sendButton.disabled = !questionInput.value.trim();
        questionInput.focus();
    }
}

sendButton.addEventListener("click", () => {
    const question = questionInput.value;
    questionInput.value = "";
    questionInput.style.height = "auto";
    sendButton.disabled = true;
    askQuestion(question);
});

questionInput.addEventListener("input", () => {
    questionInput.style.height = "auto";
    questionInput.style.height =
        `${Math.min(questionInput.scrollHeight, 150)}px`;

    sendButton.disabled = busy || !questionInput.value.trim();
});

questionInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendButton.click();
    }
});

document.querySelectorAll(".suggestion").forEach(button => {
    button.addEventListener("click", () => {
        askQuestion(button.dataset.question);
    });
});

document.getElementById("new-chat").addEventListener("click", () => {
    if (busy) return;

    messages.replaceChildren();
    messages.hidden = true;
    welcome.hidden = false;
    questionInput.value = "";
    questionInput.style.height = "auto";
    sendButton.disabled = true;
    setStatus(
        documentReady
            ? "Your document is ready for questions."
            : "No document uploaded in this session."
    );
});
