# Popo - Decider

Popo - Decider is a local browser interface for testing [Laya-MLX](https://github.com/mizorewww/laya-mlx), an Apple Silicon inference runtime for Laya typed-decision models.

It is a decision tool, not a chatbot. You provide a state (text to evaluate), a bounded question, and—when appropriate—the permitted answers. Laya returns probabilities and a structured decision as JSON without generating prose.

## What the application does

Popo - Decider lets you:

- Run `choice`, `score`, and `noul` questions.
- Start from an editable example or enter your own state and question.
- Select any of the three published Laya-MLX FP16 checkpoints.
- Inspect the complete model response as formatted raw JSON.
- Copy the JSON response to the clipboard.
- Run inference locally on an Apple Silicon Mac.

The page sends a same-origin request to the included Python server. The server validates the request, lazy-loads the selected model, calls `agent.predict(...)`, and returns the complete Laya result to the browser.

```text
Browser form
    -> POST /api/predict
    -> Python validation
    -> selected Laya-MLX checkpoint
    -> raw JSON response
```

The first request for a model downloads its checkpoint from Hugging Face. The downloaded files remain in the Hugging Face cache, and the server keeps each selected model in memory until the server stops. After a checkpoint has been downloaded, inference does not use a cloud inference API.

## Supported decision types

| Type | Use it when | Required input | Main result |
| --- | --- | --- | --- |
| `choice` | Exactly one answer must be selected from a fixed set | At least two unique options | Selected option and probability for every option |
| `score` | The answer belongs on an ordered scale | At least two levels, listed from lowest to highest | Expected zero-based score, legend, and level probabilities |
| `noul` | You want the probability that a proposition is true | A yes/no-style question; no criteria required | `P(true)` as a value from 0 to 1 |

Examples:

- `choice`: Which department should handle this request?
- `score`: How urgent is this incident?
- `noul`: Does the customer ask for a refund?

`noul` is Laya's boolean decision primitive. It returns a probability rather than generated `yes` or `no` text.

## Supported models

| Selector label | Checkpoint | Context | Intended use |
| --- | --- | ---: | --- |
| English · 421M | `aac6fef/laya-mlx` | 512 tokens | General English decisions, routing, moderation, and triage |
| Multilingual · 322M | `aac6fef/laya-multilingual-mlx` | 1,024 tokens | Non-English and multilingual input |
| Typed decisions · 421M | `aac6fef/laya-typed-decisions-mlx` | 1,024 tokens | The upstream agent-trace, customer-service, invoice-processing, and security-incident workflows |

The context budget includes the question instructions, criteria/options, internal formatting, and state. It is not all available to the state text.

For general English input, start with `aac6fef/laya-mlx`. Use the typed-decisions checkpoint only when your task resembles its specialized training workflows and you have evaluated it on representative data.

## Requirements

### Hardware and operating system

- Apple Silicon Mac (`arm64`), such as M1, M2, M3, M4, or newer.
- macOS 14 or newer.
- Several gigabytes of free disk space if you intend to download all three checkpoints.
- Several gigabytes of available memory if you load multiple checkpoints in one server session.

Intel Macs, Windows, and Linux are not supported by this MLX application.

### Software

- Python 3.11 or newer.
- Internet access for installation and the first download of each checkpoint.
- A current browser.

The project pins `laya-mlx==0.2.0` in `requirements.txt`. Its core dependencies include MLX, NumPy, Hugging Face Hub, and Tokenizers.

## Installation

Clone the repository and enter its directory:

```bash
git clone https://github.com/josecruset/classifier-laya.git
cd classifier-laya
```

If you already have the project checked out, begin in its root directory.

Create an isolated Python environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install the pinned dependencies:

```bash
python -m pip install -r requirements.txt
```

Optional installation check:

```bash
python -c "import laya_mlx, mlx; print('Laya-MLX is ready')"
```

## Running the application

Activate the environment if it is not already active:

```bash
source .venv/bin/activate
```

Start the local server:

```bash
python server.py
```

Open:

[http://127.0.0.1:8787](http://127.0.0.1:8787)

Stop the server with `Ctrl+C`. Leave the terminal running while using the page.

Do not open `dist/index.html` directly when you want to run decisions. The styling can load from a `file://` URL, but the inference API requires the Python server.

### Alternative port or host

```bash
python server.py --port 8788
python server.py --host 127.0.0.1 --port 9000
```

The default host is deliberately `127.0.0.1`, so the server is accessible only from the same computer.

## Using the page

1. Select a checkpoint from **Model**.
2. Select an example, or enter your own **State**.
3. Select `Choice`, `Score`, or `Noul`.
4. Set the **Result key**. It may contain letters, numbers, and underscores.
5. Enter the question.
6. For `choice` or `score`, enter one criterion per line.
7. Select **Run decision**, or press `Command+Enter` on macOS.
8. Inspect or copy the response from **Raw response**.

The first decision with a checkpoint may take considerably longer because the model must be downloaded and loaded. Later decisions reuse the in-memory model.

## Example response

A `choice` response has this general shape:

```json
{
  "model": "laya-rl-agent",
  "answers": {
    "department": {
      "type": "choice",
      "confidence": 0.8151,
      "action": {
        "act_probability": 1.0
      },
      "choice": "billing",
      "probabilities": {
        "billing": 0.958,
        "technical": 0.022,
        "sales": 0.02
      }
    }
  },
  "usage": {
    "input_tokens": 28,
    "output_tokens": 0
  }
}
```

Probabilities are model outputs, not guarantees. Validate accuracy and confidence thresholds on labelled examples from your own domain before automating consequential actions.

## HTTP API

The browser uses the following local endpoints. They can also be called directly.

### Health and model status

```http
GET /api/health
```

Example:

```bash
curl http://127.0.0.1:8787/api/health
```

The response lists the default model, supported models, and models currently loaded in memory.

### Run a prediction

```http
POST /api/predict
Content-Type: application/json
```

Example:

```bash
curl -H 'Content-Type: application/json' \
  -d '{
    "model": "aac6fef/laya-mlx",
    "state": "I was billed twice. Please refund the duplicate charge.",
    "question": {
      "key": "department",
      "type": "choice",
      "instructions": "Which team should handle this request?",
      "criteria": ["billing", "technical", "sales"]
    }
  }' \
  http://127.0.0.1:8787/api/predict
```

Request rules:

- `model` must be one of the three supported checkpoint IDs.
- `state` must be a non-empty string.
- `question.key` must contain only letters, numbers, and underscores.
- `question.type` must be `choice`, `score`, or `noul`.
- `choice` and `score` require at least two unique criteria.
- The maximum request body is 128 KiB.

Validation and inference errors are returned as JSON:

```json
{
  "error": "Choice and score questions need at least two criteria."
}
```

## Configuration

### Default checkpoint

Requests that omit `model` use `aac6fef/laya-mlx` by default. Set a different supported default before starting the server:

```bash
LAYA_MODEL=aac6fef/laya-multilingual-mlx python server.py
```

The browser always sends its selected model explicitly, so this environment variable primarily affects direct API clients that omit the field.

### Model lifecycle

Models load lazily. A separate lock prevents concurrent requests from loading the same checkpoint twice. Once loaded, a model remains in memory for the server session.

If memory use becomes too high after trying several models, stop and restart the server to release them.

## Privacy, networking, and security

- Inference runs on the local Mac through MLX.
- The application does not send states or results to a cloud inference API.
- Network access is required to install dependencies and download uncached checkpoints from Hugging Face.
- Downloaded checkpoints use the standard Hugging Face cache.
- The server has no authentication and is intended for local development and evaluation.
- Do not bind it to `0.0.0.0` or expose it to an untrusted network without adding authentication, transport security, origin controls, rate limiting, and production-grade request handling.

## Limitations

- Laya makes bounded decisions; it does not answer open-ended questions or generate explanations.
- The English checkpoint has a 512-token total context.
- The multilingual and typed-decisions checkpoints have a 1,024-token total context in Laya-MLX.
- Long state text may be truncated after instructions, criteria, and formatting consume part of the context budget.
- Confidence is not correctness. Calibration must be evaluated on the data distribution where the model will be used.
- The typed-decisions checkpoint is specialized and should not be treated as the best general English model.
- The server accepts one question per browser/API request, although the underlying Laya API can evaluate multiple typed questions.
- This project is a local demonstration server, not a hardened production service.

## Fine-tuned models

Laya-MLX is an inference and conversion runtime. Domain fine-tuning is performed with the upstream PyTorch [Laya project](https://github.com/NandhaKishorM/laya), usually starting from `convaiinnovations/laya` for English data.

A typical workflow is:

1. Create labelled domain examples containing state, typed questions, and target probability distributions.
2. Fine-tune and calibrate with the upstream Laya training notebook.
3. Evaluate against a separate held-out test set.
4. Convert the trained checkpoint with `laya-mlx convert`.
5. Add the converted local directory to this server's model allow-list and selector.

See the upstream [fine-tuning notebook](https://github.com/NandhaKishorM/laya/blob/main/notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb) and the [Laya-MLX conversion instructions](https://github.com/mizorewww/laya-mlx#export-an-mlx-checkpoint).

## Project structure

```text
classifier-laya/
├── dist/
│   ├── index.html      # Browser interface
│   ├── styles.css      # Responsive visual design
│   └── app.js          # Form state, validation, API requests, and JSON output
├── server.py           # Static server, API validation, and Laya model lifecycle
├── requirements.txt    # Pinned Python dependency
├── .gitignore
├── LICENSE
└── README.md
```

The server uses Python's standard-library `ThreadingHTTPServer`; no separate web framework or JavaScript build step is required.

## Development checks

Check the Python server and browser JavaScript syntax:

```bash
python3 -m py_compile server.py
node --check dist/app.js
```

`node` is needed only for the optional JavaScript syntax check, not to run Popo - Decider.

## Troubleshooting

### The page has no styling or inference does not work

Use [http://127.0.0.1:8787](http://127.0.0.1:8787) while `python server.py` is running. Do not use the `file://` page for inference.

### “Local runtime unavailable”

The browser cannot reach the Python server. Confirm the server is still running and that the browser URL uses the same port.

### Port 8787 is already in use

Start on another port:

```bash
python server.py --port 8788
```

Then open `http://127.0.0.1:8788`.

### The first request is slow

The selected checkpoint is being downloaded or initialized. Keep the server terminal open so download or model-loading errors remain visible.

### Installation fails on Intel macOS, Windows, or Linux

The `mlx` dependency required by this application targets Apple Silicon macOS. Use an Apple Silicon Mac, or replace the backend with the upstream PyTorch Laya runtime.

### Memory use grows after switching models

This is expected: the server retains every selected checkpoint for faster subsequent requests. Restart the server to clear all loaded models.

### “Unsupported Laya model”

The server intentionally accepts only the three checkpoint IDs listed above. A custom or fine-tuned checkpoint must first be added to `MODEL_IDS` in `server.py` and to the selector metadata in `dist/index.html` and `dist/app.js`.

## References

- [Laya-MLX source and documentation](https://github.com/mizorewww/laya-mlx)
- [Upstream Laya project](https://github.com/NandhaKishorM/laya)
- [Laya-MLX getting started guide](https://deepwiki.com/mizorewww/laya-mlx/1.1-getting-started)
- [Laya-MLX package information](https://www.piwheels.org/project/laya-mlx/)
- [Background article about Laya-MLX](https://aiidelist.com/blog/what-is-laya-mlx)

## License

Popo - Decider is available under the [MIT License](LICENSE).

Laya-MLX, the upstream Laya project, and model checkpoints are separate dependencies with their own licenses and notices. Review those terms before redistribution or production use.
