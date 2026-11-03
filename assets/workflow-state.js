/* Ground-truth helpers for GitHub Actions step state and build progress. */
(function attachNexaWorkflowState(root) {
  'use strict';

  const FAILURE = new Set(['failure', 'failed', 'timed_out', 'action_required', 'startup_failure']);
  const SKIPPED = new Set(['skipped', 'neutral']);
  const CANCELLED = new Set(['cancelled', 'canceled']);

  function normalizeConclusion(value) {
    const status = String(value || '').toLowerCase();
    if (status === 'success') return 'success';
    if (CANCELLED.has(status) || status === 'stopped') return 'stopped';
    if (FAILURE.has(status)) return 'failed';
    return status || 'unknown';
  }

  function getStepConclusion(step) {
    return String(step?.conclusion || (step?.status === 'completed' ? '' : step?.status) || '').toLowerCase();
  }

  function stageIndex(stage) {
    const text = String(stage || '').toLowerCase();
    if (/^checkout builder|validate build inputs|fetch uploaded zip|reassembl|upload chunk|commit upload/.test(text)) return 0;
    if (/install java|install node|install python|install icon image processor|toolchain|run nexabuild regression|configuration tests|preflight/.test(text)) return 1;
    if (/prepare android sdk|android sdk|sdkmanager/.test(text)) return 2;
    if (/validate zip|prepare static website|offline cache|extract/.test(text)) return 3;
    if (/create capacitor android wrapper|capacitor config|capacitor android wrapper/.test(text)) return 4;
    if (/configure android identity|configure android|launcher icon|generate android icons/.test(text)) return 5;
    if (/compile android apk|gradle compilation|gradle assemble|assemble(debug|release)/.test(text)) return 6;
    if (/verify apk|apksigner|metadata inspection|apk signature/.test(text)) return 7;
    if (/upload apk artifact|publish apk|release asset|github release/.test(text)) return 8;
    return -1;
  }

  function getMappedSteps(steps) {
    return (Array.isArray(steps) ? steps : []).map(step => ({ step, index: stageIndex(step?.name) })).filter(item => item.index >= 0);
  }

  function getStepSnapshot(steps) {
    const mapped = getMappedSteps(steps);
    const active = mapped.filter(({ step }) => !SKIPPED.has(getStepConclusion(step)));
    const success = active.filter(({ step }) => getStepConclusion(step) === 'success');
    const failed = mapped.filter(({ step }) => FAILURE.has(getStepConclusion(step)));
    const cancelled = mapped.filter(({ step }) => CANCELLED.has(getStepConclusion(step)));
    const skipped = mapped.filter(({ step }) => SKIPPED.has(getStepConclusion(step)));
    const completed = mapped.filter(({ step }) => step?.status === 'completed' || ['success', ...FAILURE, ...CANCELLED, ...SKIPPED].includes(getStepConclusion(step)));
    const progress = active.length ? (success.length / active.length) * 100 : 0;
    return {
      total: active.length,
      completed: completed.length,
      successful: success.length,
      failed: failed.length,
      cancelled: cancelled.length,
      skipped: skipped.length,
      progress: Math.min(99, progress),
    };
  }

  function getStageStates(steps, overallStatus = 'in_progress') {
    const mapped = getMappedSteps(steps);
    const normalizedOverall = normalizeConclusion(overallStatus);
    return Array.from({ length: 9 }, (_, index) => {
      const group = mapped.filter(item => item.index === index).map(item => item.step);
      if (normalizedOverall === 'success') return { state: 'done', steps: group.length };
      const failed = group.find(step => FAILURE.has(getStepConclusion(step)));
      if (failed) return { state: 'failed', steps: group.length, failedStep: failed.name };
      const running = group.find(step => step?.status === 'in_progress');
      if (running) return { state: 'active', steps: group.length, activeStep: running.name };
      const queued = group.find(step => step?.status === 'queued');
      if (queued) return { state: 'pending', steps: group.length, queuedStep: queued.name };
      const relevant = group.filter(step => !SKIPPED.has(getStepConclusion(step)));
      if (relevant.length && relevant.every(step => getStepConclusion(step) === 'success')) return { state: 'done', steps: group.length };
      if (group.some(step => CANCELLED.has(getStepConclusion(step)))) return { state: 'stopped', steps: group.length };
      return { state: 'pending', steps: group.length };
    });
  }

  function findRelevantStep(steps) {
    const mapped = getMappedSteps(steps).map(item => item.step);
    return mapped.find(step => FAILURE.has(getStepConclusion(step)))
      || mapped.find(step => step?.status === 'in_progress')
      || mapped.find(step => step?.status === 'queued')
      || [...mapped].reverse().find(step => getStepConclusion(step) === 'success')
      || null;
  }

  root.NexaWorkflowState = Object.freeze({ normalizeConclusion, getStepConclusion, stageIndex, getStepSnapshot, getStageStates, findRelevantStep });
})(typeof globalThis !== 'undefined' ? globalThis : window);
