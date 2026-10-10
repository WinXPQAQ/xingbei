// Both automatic play and interactive play drive the same rule iterator.
export function resolveSync(steps, decide) {
  let step = steps.next();
  while (!step.done) {
    if (step.value.type === "promise") throw new Error("同步结算不能等待异步技能");
    const choice = step.value.type === "presentation" ? null : decide(step.value);
    if (choice?.then) throw new Error("同步结算不能等待异步决定");
    step = steps.next(choice);
  }
  return step.value;
}
export async function resolveAsync(steps, decide, onPresentation = () => {}) {
  let step = steps.next();
  while (!step.done) {
    const request = step.value;
    const choice = request.type === "presentation" ? await onPresentation(request.events)
      : await (request.type === "promise" ? request.promise : decide(request));
    step = steps.next(choice);
  }
  return step.value;
}
