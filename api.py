
import os
import tempfile
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from langchain_community.document_loaders import PyPDFLoader
from langchain_community.embeddings import FastEmbedEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate

# Environment
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DB_DIR = str(BASE_DIR / "chroma_db")
MODEL_NAME = "BAAI/bge-small-en-v1.5"

app = FastAPI(title="RAG Book Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this before production
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
embeddings = FastEmbedEmbeddings(
    model_name=MODEL_NAME
)

llm = ChatGroq(model="openai/gpt-oss-120b")

prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        """You are a helpful AI assistant.
Use ONLY the provided context to answer.
If the answer is absent, say:
"I could not find the answer in the document."
"""
    ),
    (
        "human",
        "Context:\n{context}\n\nQuestion:\n{question}"
    ),
])

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
)

# Database helper
def get_vectorstore():
    if not os.path.exists(DB_DIR):
        return None

    return Chroma(
        persist_directory=DB_DIR,
        embedding_function=embeddings,
    )


class QuestionRequest(BaseModel):
    question: str


app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static"
)

@app.get("/")
def homepage():
    return FileResponse(
        str(BASE_DIR / "templates" / "index.html")
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "database_exists": os.path.exists(DB_DIR),
    }


@app.post("/upload")
def upload_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF file.",
        )

    temp_path = None

    try:
        content = file.file.read()

        if not content:
            raise HTTPException(
                status_code=400,
                detail="The uploaded PDF is empty.",
            )

        with tempfile.NamedTemporaryFile(
            suffix=".pdf", delete=False
        ) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        documents = PyPDFLoader(temp_path).load()

        if not documents:
            raise HTTPException(
                status_code=400,
                detail="No readable pages found in the PDF.",
            )

        chunks = splitter.split_documents(documents)

        if not chunks:
            raise HTTPException(
                status_code=400,
                detail="No readable text found in the PDF.",
            )

        # Adds documents to the persistent Chroma collection.
        # Existing documents are not automatically deleted.
        batch_size = 8

        vectorstore = Chroma(
            collection_name="langchain",
            persist_directory=DB_DIR,
            embedding_function=embeddings,
        )

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            vectorstore.add_documents(batch)

            del batch

        return {
            "message": "PDF processed successfully.",
            "filename": file.filename,
            "pages": len(documents),
            "chunks": len(chunks),
        }

    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"PDF processing failed: {str(exc)}",
        )
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        file.file.close()


@app.post("/ask")
def ask_question(request: QuestionRequest):
    question = request.question.strip()

    if not question:
        raise HTTPException(
            status_code=400,
            detail="Question cannot be empty.",
        )

    try:
        vectorstore = get_vectorstore()

        if vectorstore is None:
            raise HTTPException(
                status_code=400,
                detail="Upload a PDF before asking questions.",
            )

        retriever = vectorstore.as_retriever(
            search_type="mmr",
            search_kwargs={
                "k": 4,
                "fetch_k": 10,
                "lambda_mult": 0.5,
            },
        )

        docs = retriever.invoke(question)

        if not docs:
            return {
                "question": question,
                "answer": "I could not find the answer in the document.",
                "sources": [],
            }

        context = "\n\n".join(
            doc.page_content for doc in docs
        )

        response = llm.invoke(
            prompt.invoke({
                "context": context,
                "question": question,
            })
        )

        sources = [
            {
                "page": doc.metadata.get("page"),
                "source": Path(
                    doc.metadata.get("source", "")
                ).name,
            }
            for doc in docs
        ]

        return {
            "question": question,
            "answer": response.content,
            "sources": sources,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Question answering failed: {str(exc)}",
        )
