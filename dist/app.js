const examples = [
  {
    id: "support",
    name: "Support route",
    type: "choice",
    key: "department",
    state: "I was billed twice for my subscription. Please refund the duplicate charge today.",
    instructions: "Which department should handle this request?",
    criteria: ["billing", "technical", "sales", "other"],
  },
  {
    id: "incident",
    name: "Incident urgency",
    type: "score",
    key: "urgency",
    state: "Our checkout has been unavailable for 35 minutes and customers cannot complete purchases.",
    instructions: "How urgent is this incident?",
    criteria: ["not urgent", "needs attention soon", "critical or blocking"],
  },
  {
    id: "refund",
    name: "Refund signal",
    type: "noul",
    key: "refund_requested",
    state: "The headphones arrived damaged. I no longer want a replacement; send the payment back to my card.",
    instructions: "Does the customer ask for money back?",
    criteria: [],
  },
];

const models = {
  "aac6fef/laya-mlx": {
    context: "English · 512-token context",
    chip: "EN · 512",
    description: "English decisions · FP16. First use downloads and loads this checkpoint.",
  },
  "aac6fef/laya-multilingual-mlx": {
    context: "Multilingual · 1,024-token context",
    chip: "MULTI · 1K",
    description: "Multilingual input · FP16. First use downloads and loads this checkpoint.",
  },
  "aac6fef/laya-typed-decisions-mlx": {
    context: "Typed decisions · 1,024-token context",
    chip: "TYPED · 1K",
    description: "Specialized typed-decision workflows · FP16. First use downloads and loads this checkpoint.",
  },
};

const form = document.querySelector("#decisionForm");
const presetList = document.querySelector("#presetList");
const stateInput = document.querySelector("#stateInput");
const questionKey = document.querySelector("#questionKey");
const instructionsInput = document.querySelector("#instructionsInput");
const criteriaInput = document.querySelector("#criteriaInput");
const criteriaGroup = document.querySelector("#criteriaGroup");
const criteriaLabel = document.querySelector("#criteriaLabel");
const criteriaHelp = document.querySelector("#criteriaHelp");
const stateCount = document.querySelector("#stateCount");
const formMessage = document.querySelector("#formMessage");
const runButton = document.querySelector("#runButton");
const resetButton = document.querySelector("#resetButton");
const jsonOutput = document.querySelector("#jsonOutput code");
const copyButton = document.querySelector("#copyButton");
const outputState = document.querySelector("#outputState");
const latencyValue = document.querySelector("#latencyValue");
const runtimeStatus = document.querySelector("#runtimeStatus");
const modelSelect = document.querySelector("#modelSelect");
const modelContext = document.querySelector("#modelContext");
const modelChip = document.querySelector("#modelChip");
const modelName = document.querySelector("#modelName");
const modelDescription = document.querySelector("#modelDescription");

let activeExampleId = examples[0].id;
let lastJson = "";
let loadedModels = [];

function renderExamples() {
  presetList.innerHTML = examples
    .map(
      (example) => `
        <button
          class="preset-button${example.id === activeExampleId ? " active" : ""}"
          type="button"
          data-example-id="${example.id}"
          aria-pressed="${example.id === activeExampleId}"
        >
          <strong>${example.name}</strong>
          <span>${example.type}</span>
        </button>`,
    )
    .join("");
}

function selectedType() {
  return form.elements.decisionType.value;
}

function updateTypeFields() {
  const type = selectedType();
  const usesCriteria = type !== "noul";
  criteriaGroup.classList.toggle("criteria-hidden", !usesCriteria);
  criteriaInput.required = usesCriteria;

  if (type === "score") {
    criteriaLabel.textContent = "Ordered levels";
    criteriaHelp.textContent = "Lowest to highest, one level per line";
  } else {
    criteriaLabel.textContent = "Options";
    criteriaHelp.textContent = "One possible answer per line";
  }
}

function loadExample(exampleId) {
  const example = examples.find((item) => item.id === exampleId) ?? examples[0];
  activeExampleId = example.id;
  stateInput.value = example.state;
  questionKey.value = example.key;
  instructionsInput.value = example.instructions;
  criteriaInput.value = example.criteria.join("\n");
  form.elements.decisionType.value = example.type;
  formMessage.textContent = "";
  renderExamples();
  updateTypeFields();
  updateStateCount();
}

function updateStateCount() {
  const count = stateInput.value.length;
  stateCount.textContent = `${count} character${count === 1 ? "" : "s"}`;
}

function updateModelDetails() {
  const modelId = modelSelect.value;
  const details = models[modelId];
  modelContext.textContent = details.context;
  modelChip.textContent = details.chip;
  modelName.textContent = modelId;
  modelDescription.textContent = details.description;

  runtimeStatus.className = "runtime-status ready";
  runtimeStatus.querySelector("span:last-child").textContent = loadedModels.includes(modelId)
    ? "Selected model loaded · local"
    : "Runtime ready · selected model loads on first run";
}

function setOutput(payload, status, latency = null) {
  lastJson = JSON.stringify(payload, null, 2);
  jsonOutput.textContent = lastJson;
  copyButton.disabled = false;
  outputState.className = `output-state ${status}`;
  outputState.textContent = status === "success" ? "Decision complete" : "Request failed";
  latencyValue.textContent = latency === null ? "—" : `${Math.round(latency)} ms total`;
}

function validateCriteria(type, criteria) {
  if (type === "noul") return true;
  if (criteria.length < 2) {
    formMessage.textContent = `${type === "score" ? "Score" : "Choice"} needs at least two ${
      type === "score" ? "ordered levels" : "options"
    }.`;
    criteriaInput.focus();
    return false;
  }
  return true;
}

async function requestPrediction(body) {
  runButton.disabled = true;
  runButton.querySelector(".run-label").textContent = "Running…";
  outputState.className = "output-state";
  outputState.textContent = "Laya is deciding";
  latencyValue.textContent = "—";

  const startedAt = performance.now();
  try {
    const response = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
    if (!loadedModels.includes(body.model)) loadedModels.push(body.model);
    updateModelDetails();
    setOutput(payload, "success", performance.now() - startedAt);
    return payload;
  } catch (error) {
    const payload = { error: error instanceof Error ? error.message : "Unknown request error" };
    setOutput(payload, "error", performance.now() - startedAt);
    throw error;
  } finally {
    runButton.disabled = false;
    runButton.querySelector(".run-label").textContent = "Run decision";
  }
}

async function runDecision(event) {
  event.preventDefault();
  formMessage.textContent = "";

  if (!form.reportValidity()) return;

  const type = selectedType();
  const criteria = criteriaInput.value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!validateCriteria(type, criteria)) return;

  const question = {
    key: questionKey.value.trim(),
    type,
    instructions: instructionsInput.value.trim(),
  };
  if (type !== "noul") question.criteria = criteria;

  try {
    await requestPrediction({ model: modelSelect.value, state: stateInput.value.trim(), question });
  } catch {
    // requestPrediction has already rendered the useful error state.
  }
}

async function checkRuntime() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("Runtime unavailable");
    const health = await response.json();
    loadedModels = health.loaded_models ?? [];
    updateModelDetails();
  } catch {
    runtimeStatus.className = "runtime-status error";
    runtimeStatus.querySelector("span:last-child").textContent = "Local runtime unavailable";
  }
}

function registerWebMcpTool() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const lifecycle = new AbortController();
  const tool = {
    name: "run_laya_decision",
    title: "Run Laya decision",
    description:
      "Run one Laya-MLX choice, score, or noul decision and show its raw JSON response in the page.",
    inputSchema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          enum: [
            "aac6fef/laya-mlx",
            "aac6fef/laya-multilingual-mlx",
            "aac6fef/laya-typed-decisions-mlx",
          ],
        },
        state: { type: "string", minLength: 1, description: "Text or context to evaluate." },
        question: {
          type: "object",
          properties: {
            key: { type: "string", pattern: "^[A-Za-z0-9_]+$" },
            type: { type: "string", enum: ["choice", "score", "noul"] },
            instructions: { type: "string", minLength: 1 },
            criteria: {
              type: "array",
              items: { type: "string", minLength: 1 },
              minItems: 2,
              description: "Required for choice and score; omit for noul.",
            },
          },
          required: ["key", "type", "instructions"],
          additionalProperties: false,
        },
      },
      required: ["model", "state", "question"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input !== "object" || typeof input.state !== "string" || !models[input.model]) {
        throw new Error("A supported model, non-empty state, and typed question are required.");
      }
      const { question } = input;
      if (!question || !["choice", "score", "noul"].includes(question.type)) {
        throw new Error("Question type must be choice, score, or noul.");
      }
      if (question.type !== "noul" && (!Array.isArray(question.criteria) || question.criteria.length < 2)) {
        throw new Error("Choice and score questions require at least two criteria.");
      }

      stateInput.value = input.state;
      modelSelect.value = input.model;
      questionKey.value = question.key;
      instructionsInput.value = question.instructions;
      criteriaInput.value = Array.isArray(question.criteria) ? question.criteria.join("\n") : "";
      form.elements.decisionType.value = question.type;
      activeExampleId = "";
      renderExamples();
      updateTypeFields();
      updateStateCount();
      updateModelDetails();

      return requestPrediction(input);
    },
  };

  try {
    void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
  } catch {
    // WebMCP is optional; the visible workflow remains fully functional.
  }
}

presetList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-example-id]");
  if (button) loadExample(button.dataset.exampleId);
});

form.addEventListener("submit", runDecision);
form.addEventListener("input", (event) => {
  if (event.target === stateInput) updateStateCount();
  if (event.target.matches("input, textarea")) {
    activeExampleId = "";
    renderExamples();
  }
});

form.elements.decisionType.forEach((radio) => {
  radio.addEventListener("change", () => {
    activeExampleId = "";
    renderExamples();
    updateTypeFields();
  });
});

modelSelect.addEventListener("change", updateModelDetails);

resetButton.addEventListener("click", () => loadExample(activeExampleId || examples[0].id));

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(lastJson);
  const original = copyButton.textContent;
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = original;
  }, 1200);
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    form.requestSubmit();
  }
});

renderExamples();
loadExample(activeExampleId);
updateModelDetails();
checkRuntime();
registerWebMcpTool();
