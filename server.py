#!/usr/bin/env python3
"""Local web server for the Popo - Decider Laya-MLX demo."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = ROOT / "dist"
MODEL_IDS = {
    "aac6fef/laya-mlx",
    "aac6fef/laya-multilingual-mlx",
    "aac6fef/laya-typed-decisions-mlx",
}
DEFAULT_MODEL_ID = os.environ.get("LAYA_MODEL", "aac6fef/laya-mlx")
MAX_BODY_BYTES = 128 * 1024

if DEFAULT_MODEL_ID not in MODEL_IDS:
    raise RuntimeError(f"Unsupported LAYA_MODEL: {DEFAULT_MODEL_ID}")

_agents: dict[str, Any] = {}
_agent_locks = {model_id: threading.Lock() for model_id in MODEL_IDS}


def get_agent(model_id: str) -> Any:
    """Load each supported checkpoint once, when it is first selected."""
    if model_id not in MODEL_IDS:
        raise ValueError("Unsupported Laya model.")
    if model_id not in _agents:
        with _agent_locks[model_id]:
            if model_id not in _agents:
                import laya_mlx as laya

                _agents[model_id] = laya.load(model_id, dtype="float16")
    return _agents[model_id]


def json_default(value: Any) -> Any:
    """Convert NumPy/MLX scalar-like values without changing result structure."""
    if hasattr(value, "item"):
        return value.item()
    if hasattr(value, "tolist"):
        return value.tolist()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def validate_request(payload: Any) -> tuple[str, str, dict[str, dict[str, Any]]]:
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")

    state = payload.get("state")
    question = payload.get("question")
    model_id = payload.get("model", DEFAULT_MODEL_ID)
    if not isinstance(state, str) or not state.strip():
        raise ValueError("State is required.")
    if not isinstance(question, dict):
        raise ValueError("Question is required.")
    if model_id not in MODEL_IDS:
        raise ValueError("Unsupported Laya model.")

    key = question.get("key", "decision")
    decision_type = question.get("type")
    instructions = question.get("instructions")
    if not isinstance(key, str) or not key.strip():
        raise ValueError("Result key is required.")
    if not key.replace("_", "").isalnum():
        raise ValueError("Result key may contain only letters, numbers, and underscores.")
    if decision_type not in {"choice", "score", "noul"}:
        raise ValueError("Question type must be choice, score, or noul.")
    if not isinstance(instructions, str) or not instructions.strip():
        raise ValueError("Question instructions are required.")

    typed_question: dict[str, Any] = {
        "type": decision_type,
        "instructions": instructions.strip(),
    }

    if decision_type in {"choice", "score"}:
        criteria = question.get("criteria")
        if not isinstance(criteria, list):
            raise ValueError("Criteria must be a list.")
        cleaned = [item.strip() for item in criteria if isinstance(item, str) and item.strip()]
        if len(cleaned) < 2:
            raise ValueError("Choice and score questions need at least two criteria.")
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("Criteria must be unique.")
        typed_question["criteria"] = cleaned

    return model_id, state.strip(), {key.strip(): typed_question}


class DemoHandler(BaseHTTPRequestHandler):
    server_version = "PopoDecider/1.0"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(
                {
                    "status": "ok",
                    "default_model": DEFAULT_MODEL_ID,
                    "available_models": sorted(MODEL_IDS),
                    "loaded_models": sorted(_agents),
                }
            )
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/predict":
            self.send_error_json(HTTPStatus.NOT_FOUND, "Endpoint not found.")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                raise ValueError("Request body is required.")
            if content_length > MAX_BODY_BYTES:
                self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Request is too large.")
                return

            payload = json.loads(self.rfile.read(content_length))
            model_id, state, questions = validate_request(payload)
            result = get_agent(model_id).predict(state, questions)
            self.send_json(result)
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Request body is not valid JSON.")
        except ValueError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except ModuleNotFoundError:
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "Laya-MLX is not installed. Run the setup command from README.md.",
            )
        except Exception as error:  # Keep the UI useful without exposing a traceback.
            self.send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                f"Laya inference failed: {error}",
            )

    def serve_static(self, request_path: str) -> None:
        relative = unquote(request_path).lstrip("/") or "index.html"
        candidate = (STATIC_ROOT / relative).resolve()
        if STATIC_ROOT.resolve() not in candidate.parents and candidate != STATIC_ROOT.resolve():
            self.send_error_json(HTTPStatus.FORBIDDEN, "Invalid path.")
            return
        if candidate.is_dir():
            candidate = candidate / "index.html"
        if not candidate.is_file():
            candidate = STATIC_ROOT / "index.html"
        if not candidate.is_file():
            self.send_error_json(HTTPStatus.NOT_FOUND, "Demo files were not found.")
            return

        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        data = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False, indent=2, default=json_default).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"error": message}, status)

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format_string % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Popo - Decider demo locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), DemoHandler)
    print(f"Popo - Decider is running at http://{args.host}:{args.port}")
    print(f"Default Laya model: {DEFAULT_MODEL_ID}")
    print("Each selected checkpoint is loaded on its first request.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
