/*
  Architecture summary:
  - TimerEngine: drift-resistant time calculations using performance.now().
  - StateManager: finite state transitions and invalid action guards.
  - CountdownParserValidator: HH/MM/SS parsing + validation.
  - Renderer: DOM updates for display, controls, and messaging.
  - Controller: event orchestration and animation loop lifecycle.
*/

(function bootstrap() {
  "use strict";

  const MODES = Object.freeze({
    STOPWATCH: "stopwatch",
    COUNTDOWN: "countdown"
  });

  const STATUS = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
    COMPLETED: "completed"
  });

  const ACTIONS = Object.freeze({
    SWITCH_MODE: "switch_mode",
    START: "start",
    PAUSE: "pause",
    RESUME: "resume",
    CLEAR: "clear",
    COMPLETE: "complete"
  });

  function log(message, meta) {
    if (meta) {
      console.info(`[TimerApp] ${message}`, meta);
      return;
    }
    console.info(`[TimerApp] ${message}`);
  }

  function formatMainTime(ms) {
    const safeMs = Math.max(0, ms);
    const totalSeconds = Math.floor(safeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
      .map((unit) => String(unit).padStart(2, "0"))
      .join(":");
  }

  function formatMillis(ms) {
    const milli = Math.floor(Math.max(0, ms) % 1000);
    return String(milli).padStart(3, "0");
  }

  class TimerEngine {
    constructor() {
      this.mode = MODES.STOPWATCH;
      this.elapsedBeforeRunMs = 0;
      this.runStartTs = 0;
      this.isRunning = false;
      this.countdownTotalMs = 0;
    }

    setMode(mode) {
      this.mode = mode;
      this.reset();
    }

    configureCountdown(totalMs) {
      this.countdownTotalMs = totalMs;
      this.elapsedBeforeRunMs = 0;
      this.runStartTs = 0;
      this.isRunning = false;
    }

    start(startTs, initialElapsedMs) {
      if (this.isRunning) {
        return;
      }
      this.elapsedBeforeRunMs = Number.isFinite(initialElapsedMs)
        ? Math.max(0, initialElapsedMs)
        : this.elapsedBeforeRunMs;
      this.runStartTs = startTs;
      this.isRunning = true;
    }

    pause(nowTs) {
      if (!this.isRunning) {
        return;
      }
      this.elapsedBeforeRunMs += Math.max(0, nowTs - this.runStartTs);
      this.isRunning = false;
    }

    resume(nowTs) {
      if (this.isRunning) {
        return;
      }
      this.runStartTs = nowTs;
      this.isRunning = true;
    }

    reset() {
      this.elapsedBeforeRunMs = 0;
      this.runStartTs = 0;
      this.isRunning = false;
      if (this.mode === MODES.STOPWATCH) {
        this.countdownTotalMs = 0;
      }
    }

    tick(nowTs) {
      const liveElapsed = this.isRunning
        ? this.elapsedBeforeRunMs + Math.max(0, nowTs - this.runStartTs)
        : this.elapsedBeforeRunMs;

      if (this.mode === MODES.STOPWATCH) {
        return {
          elapsedMs: liveElapsed,
          displayMs: liveElapsed,
          remainingMs: 0,
          completed: false
        };
      }

      const remainingMs = Math.max(0, this.countdownTotalMs - liveElapsed);
      const completed = remainingMs === 0 && this.countdownTotalMs > 0;

      return {
        elapsedMs: liveElapsed,
        displayMs: remainingMs,
        remainingMs,
        completed
      };
    }
  }

  class StateManager {
    constructor() {
      this.mode = MODES.STOPWATCH;
      this.status = STATUS.IDLE;
    }

    transition(action, payload) {
      const targetMode = payload && payload.mode;

      switch (action) {
        case ACTIONS.SWITCH_MODE:
          if (!Object.values(MODES).includes(targetMode)) {
            return this.error("Unknown mode selected.");
          }
          this.mode = targetMode;
          this.status = STATUS.IDLE;
          return this.ok();

        case ACTIONS.START:
          if (this.status !== STATUS.IDLE) {
            return this.error("Start is only allowed from idle state.");
          }
          this.status = STATUS.RUNNING;
          return this.ok();

        case ACTIONS.PAUSE:
          if (this.status !== STATUS.RUNNING) {
            return this.error("Pause is only allowed while running.");
          }
          this.status = STATUS.PAUSED;
          return this.ok();

        case ACTIONS.RESUME:
          if (this.status !== STATUS.PAUSED) {
            return this.error("Resume is only allowed while paused.");
          }
          this.status = STATUS.RUNNING;
          return this.ok();

        case ACTIONS.CLEAR:
          this.status = STATUS.IDLE;
          return this.ok();

        case ACTIONS.COMPLETE:
          if (this.mode !== MODES.COUNTDOWN) {
            return this.error("Complete action is only valid for countdown mode.");
          }
          this.status = STATUS.COMPLETED;
          return this.ok();

        default:
          return this.error("Unsupported action.");
      }
    }

    snapshot() {
      return {
        mode: this.mode,
        status: this.status
      };
    }

    ok() {
      return {
        ok: true,
        state: this.snapshot()
      };
    }

    error(message) {
      return {
        ok: false,
        error: message,
        state: this.snapshot()
      };
    }
  }

  class CountdownParserValidator {
    parseCountdownInputs(values) {
      const errors = [];

      const hh = this.parseIntField(values.hh, "Hours", 0, 99, errors);
      const mm = this.parseIntField(values.mm, "Minutes", 0, 59, errors);
      const ss = this.parseIntField(values.ss, "Seconds", 0, 59, errors);

      if (errors.length > 0) {
        return {
          valid: false,
          totalMs: 0,
          errors
        };
      }

      const totalSeconds = hh * 3600 + mm * 60 + ss;

      if (totalSeconds === 0) {
        errors.push("Countdown duration must be greater than 00:00:00.");
      }

      return {
        valid: errors.length === 0,
        totalMs: totalSeconds * 1000,
        errors
      };
    }

    parseIntField(raw, label, min, max, errors) {
      const text = String(raw).trim();

      if (text.length === 0) {
        errors.push(`${label} is required.`);
        return 0;
      }

      if (!/^\d+$/.test(text)) {
        errors.push(`${label} must be a whole number.`);
        return 0;
      }

      const value = Number(text);

      if (!Number.isFinite(value)) {
        errors.push(`${label} is invalid.`);
        return 0;
      }

      if (value < min) {
        errors.push(`${label} cannot be negative.`);
      }

      if (value > max) {
        errors.push(`${label} must be between ${min} and ${max}.`);
      }

      return value;
    }
  }

  class AlertService {
    constructor() {
      this.audioContext = null;
    }

    async beep() {
      try {
        if (!this.audioContext) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) {
            log("AudioContext not available, visual completion only.");
            return;
          }
          this.audioContext = new Ctx();
        }

        if (this.audioContext.state === "suspended") {
          await this.audioContext.resume();
        }

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const now = this.audioContext.currentTime;

        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        osc.start(now);
        osc.stop(now + 0.22);
      } catch (error) {
        console.warn("[TimerApp] Beep failed, visual completion only.", error);
      }
    }
  }

  class Renderer {
    constructor(dom) {
      this.dom = dom;
    }

    render(viewModel) {
      const { mode, status, displayMs, errorMessage, successMessage } = viewModel;

      this.dom.timeMain.textContent = formatMainTime(displayMs);
      this.dom.timeSub.textContent = mode === MODES.STOPWATCH ? formatMillis(displayMs) : "000";
      this.dom.countdownInputs.classList.toggle("hidden", mode !== MODES.COUNTDOWN);

      const buttonState = this.computeButtonState(status, mode, viewModel.canStartCountdown);
      this.dom.startBtn.disabled = !buttonState.start;
      this.dom.pauseBtn.disabled = !buttonState.pause;
      this.dom.resumeBtn.disabled = !buttonState.resume;
      this.dom.clearBtn.disabled = !buttonState.clear;

      this.dom.statusMessage.textContent = "";
      this.dom.statusMessage.className = "status";

      if (errorMessage) {
        this.dom.statusMessage.textContent = errorMessage;
        this.dom.statusMessage.classList.add("error");
      } else if (successMessage) {
        this.dom.statusMessage.textContent = successMessage;
        this.dom.statusMessage.classList.add("success");
      }
    }

    computeButtonState(status, mode, canStartCountdown) {
      const base = {
        start: false,
        pause: false,
        resume: false,
        clear: true
      };

      if (status === STATUS.IDLE) {
        base.start = mode === MODES.COUNTDOWN ? canStartCountdown : true;
      } else if (status === STATUS.RUNNING) {
        base.pause = true;
      } else if (status === STATUS.PAUSED) {
        base.resume = true;
      }

      return base;
    }
  }

  class Controller {
    constructor() {
      this.dom = {
        modeStopwatch: document.getElementById("mode-stopwatch"),
        modeCountdown: document.getElementById("mode-countdown"),
        timeMain: document.getElementById("timeMain"),
        timeSub: document.getElementById("timeSub"),
        countdownInputs: document.getElementById("countdownInputs"),
        hoursInput: document.getElementById("hoursInput"),
        minutesInput: document.getElementById("minutesInput"),
        secondsInput: document.getElementById("secondsInput"),
        startBtn: document.getElementById("startBtn"),
        pauseBtn: document.getElementById("pauseBtn"),
        resumeBtn: document.getElementById("resumeBtn"),
        clearBtn: document.getElementById("clearBtn"),
        statusMessage: document.getElementById("statusMessage")
      };

      this.engine = new TimerEngine();
      this.stateManager = new StateManager();
      this.validator = new CountdownParserValidator();
      this.renderer = new Renderer(this.dom);
      this.alertService = new AlertService();

      this.rafId = null;
      this.beepPlayedForCycle = false;
      this.latestValidation = {
        valid: true,
        totalMs: 0,
        errors: []
      };

      this.bindEvents();
      this.validateCountdownInputs();
      this.render(0, "");
      log("App initialized.");
    }

    bindEvents() {
      this.dom.modeStopwatch.addEventListener("change", () => this.handleModeChange(MODES.STOPWATCH));
      this.dom.modeCountdown.addEventListener("change", () => this.handleModeChange(MODES.COUNTDOWN));

      [this.dom.hoursInput, this.dom.minutesInput, this.dom.secondsInput].forEach((input) => {
        input.addEventListener("input", () => {
          this.validateCountdownInputs();
          this.render(this.getDisplayMs(), "");
        });
      });

      this.dom.startBtn.addEventListener("click", () => this.safeRun(() => this.handleStart()));
      this.dom.pauseBtn.addEventListener("click", () => this.safeRun(() => this.handlePause()));
      this.dom.resumeBtn.addEventListener("click", () => this.safeRun(() => this.handleResume()));
      this.dom.clearBtn.addEventListener("click", () => this.safeRun(() => this.handleClear()));
    }

    safeRun(fn) {
      try {
        fn();
      } catch (error) {
        console.error("[TimerApp] Unexpected error.", error);
        this.render(this.getDisplayMs(), "Unexpected error occurred. Try again.");
      }
    }

    handleModeChange(mode) {
      const transition = this.stateManager.transition(ACTIONS.SWITCH_MODE, { mode });
      if (!transition.ok) {
        this.render(this.getDisplayMs(), transition.error);
        return;
      }

      this.stopLoop();
      this.engine.setMode(mode);
      this.beepPlayedForCycle = false;
      this.validateCountdownInputs();
      this.render(0, "");
      log("Mode changed.", transition.state);
    }

    handleStart() {
      const state = this.stateManager.snapshot();
      if (state.mode === MODES.COUNTDOWN) {
        this.validateCountdownInputs();
        if (!this.latestValidation.valid) {
          this.render(this.getDisplayMs(), this.latestValidation.errors.join(" "));
          return;
        }
        this.engine.configureCountdown(this.latestValidation.totalMs);
      }

      const transition = this.stateManager.transition(ACTIONS.START);
      if (!transition.ok) {
        this.render(this.getDisplayMs(), transition.error);
        return;
      }

      this.engine.start(performance.now(), 0);
      this.beepPlayedForCycle = false;
      this.startLoop();
      this.render(this.getDisplayMs(), "");
      log("Started.", transition.state);
    }

    handlePause() {
      const transition = this.stateManager.transition(ACTIONS.PAUSE);
      if (!transition.ok) {
        this.render(this.getDisplayMs(), transition.error);
        return;
      }

      this.engine.pause(performance.now());
      this.stopLoop();
      this.render(this.getDisplayMs(), "");
      log("Paused.", transition.state);
    }

    handleResume() {
      const transition = this.stateManager.transition(ACTIONS.RESUME);
      if (!transition.ok) {
        this.render(this.getDisplayMs(), transition.error);
        return;
      }

      this.engine.resume(performance.now());
      this.startLoop();
      this.render(this.getDisplayMs(), "");
      log("Resumed.", transition.state);
    }

    handleClear() {
      const transition = this.stateManager.transition(ACTIONS.CLEAR);
      if (!transition.ok) {
        this.render(this.getDisplayMs(), transition.error);
        return;
      }

      this.stopLoop();
      this.engine.reset();
      this.beepPlayedForCycle = false;
      this.validateCountdownInputs();
      this.render(0, "");
      log("Cleared.", transition.state);
    }

    startLoop() {
      if (this.rafId !== null) {
        return;
      }

      const loop = (now) => {
        const tick = this.engine.tick(now);

        if (this.stateManager.snapshot().mode === MODES.COUNTDOWN && tick.completed) {
          this.engine.pause(now);
          this.stopLoop();
          const transition = this.stateManager.transition(ACTIONS.COMPLETE);
          const successMessage = transition.ok ? "Countdown completed." : "Countdown completed.";

          if (!this.beepPlayedForCycle) {
            this.beepPlayedForCycle = true;
            this.alertService.beep();
          }

          this.render(0, "", successMessage);
          log("Countdown completed.", this.stateManager.snapshot());
          return;
        }

        this.render(tick.displayMs, "");
        this.rafId = window.requestAnimationFrame(loop);
      };

      this.rafId = window.requestAnimationFrame(loop);
    }

    stopLoop() {
      if (this.rafId === null) {
        return;
      }
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    validateCountdownInputs() {
      this.latestValidation = this.validator.parseCountdownInputs({
        hh: this.dom.hoursInput.value,
        mm: this.dom.minutesInput.value,
        ss: this.dom.secondsInput.value
      });

      if (this.stateManager.snapshot().mode === MODES.COUNTDOWN) {
        const errorText = this.latestValidation.valid ? "" : this.latestValidation.errors.join(" ");
        this.render(this.getDisplayMs(), errorText);
      }
    }

    getDisplayMs() {
      const tick = this.engine.tick(performance.now());
      return tick.displayMs;
    }

    render(displayMs, errorMessage, successMessage) {
      const snapshot = this.stateManager.snapshot();
      const canStartCountdown = this.latestValidation.valid;
      this.renderer.render({
        mode: snapshot.mode,
        status: snapshot.status,
        displayMs,
        canStartCountdown,
        errorMessage,
        successMessage
      });
    }
  }

  new Controller();
})();
