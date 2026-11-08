// ORIGINAL standalone PRIVATE UI. Format only. No availability, ownership, payments or native mutations.
// This fixed local module import contains public Unicode data only; no candidate-policy imports.
const defaultLoadRuntime = () => import('./emoji17.mjs');
const STYLESHEET_URL = new URL('./emoji-format-checker.css', import.meta.url).href;
export const MAX_INPUT_CODE_UNITS = 4096; // Prototype guard, not character count or economic policy.
const EXPECTED = Object.freeze({ unicodeVersion: '17.0.0', emojiVersion: '17.0' });
const INIT_ERROR = 'The emoji spelling checker could not initialize. This affects only this format checker. Native naming and payments remain disabled.';
const CHECKER_ERROR = 'The emoji spelling checker encountered an internal format-checking error. This checker is disabled. Native naming and payments remain disabled.';
const supported = new Set(['fully-qualified', 'minimally-qualified', 'unqualified']);
const inputErrors = Object.freeze({
 EMPTY_LABEL: 'Enter 1–32 supported whole emoji sequences.',
 LABEL_TOO_LONG: 'This spelling has more than 32 recognized whole emoji sequences. Use 1–32.',
 COMPONENT_NOT_A_NAME: 'Standalone emoji components are not accepted. Use supported whole emoji sequences.',
 UNSUPPORTED_SEQUENCE: 'This is not a supported emoji-only Unicode 17 spelling. Nothing was changed or submitted.',
 INVALID_INPUT: 'Use a supported emoji-only spelling within this field’s prototype length guard.',
 QUALIFICATION_NOT_ACCEPTED: 'This display qualification is not supported by this spelling checker.',
});
function settings(options) {
 if (options === undefined) return { loadRuntime: defaultLoadRuntime };
 if (!options || typeof options !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new TypeError('A plain options record is required.');
 const keys = Reflect.ownKeys(options);
 if (keys.some(k => k !== 'loadRuntime')) throw new TypeError('Unknown checker option.');
 const d = Object.getOwnPropertyDescriptor(options, 'loadRuntime');
 if (d && (!Object.hasOwn(d, 'value') || !d.enumerable || typeof d.value !== 'function')) throw new TypeError('A trusted runtime loader function is required.');
 return { loadRuntime: d ? d.value : defaultLoadRuntime };
}
function describe(result, original) {
 // Deliberately read no lengthTier, qualificationForm, canonical representative or names.
 if (!result || !Number.isInteger(result.emojiCount) || result.emojiCount < 1 || result.emojiCount > 32 || !Array.isArray(result.tokens) || result.tokens.length !== result.emojiCount) throw new TypeError('Invalid format result.');
 const counts = { 'fully-qualified': 0, 'minimally-qualified': 0, unqualified: 0 }; let joined = '';
 for (let i = 0; i < result.tokens.length; i++) {
  if (!Object.hasOwn(result.tokens, i)) throw new TypeError('Invalid format result.');
  const token = result.tokens[i];
  if (!token || typeof token.inputSequence !== 'string' || !token.inputSequence.length || !token.record || !supported.has(token.record.qualification)) throw new TypeError('Invalid format result.');
  joined += token.inputSequence; counts[token.record.qualification]++;
 }
 if (joined !== original) throw new TypeError('A spelling checker must not alter input.');
 const qualification = Object.entries(counts).filter(([, n]) => n).map(([q, n]) => `${n} ${q}`).join(', ');
 return `Recognized count: ${result.emojiCount} whole emoji ${result.emojiCount === 1 ? 'sequence' : 'sequences'}.\nDisplay qualification: ${qualification}.`;
}
/** Mount only within an explicit owned container; append one isolated host, never replace surrounding DOM.
 * loadRuntime is trusted-code/test injection only and receives no input or DOM references.
 * ready resolves boolean only; no result/input callbacks, globals, storage or telemetry.
 */
export function mountEmojiFormatChecker(container, options) {
 const { loadRuntime } = settings(options);
 if (!container || container.nodeType !== 1 || typeof container.appendChild !== 'function' || !container.ownerDocument || typeof container.ownerDocument.createElement !== 'function') throw new TypeError('An explicit element container is required.');
 const doc = container.ownerDocument, host = doc.createElement('div');
 host.setAttribute('data-component', 'emoji-format-checker');
 let shadow, isolated = true;
 try { shadow = host.attachShadow({ mode: 'closed' }); } catch { shadow = host; isolated = false; }
 const el = (tag, text) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
 const stylesheet = el('link');
 stylesheet.setAttribute('rel', 'stylesheet'); stylesheet.setAttribute('href', STYLESHEET_URL); stylesheet.setAttribute('referrerpolicy', 'no-referrer');
 const section = el('section'), title = el('h2', 'Emoji-only Unicode 17 spelling check');
 const help = el('p', 'Accepts 1–32 recognized whole emoji sequences, including official fully-qualified, minimally-qualified and unqualified spellings. Input is checked exactly as entered. Use the Check spelling button; Enter does not submit.');
 help.id = 'emoji-format-help'; help.className = 'help';
 const notice = el('p', 'Spelling only—not a name availability or ownership check. Native naming and payments are disabled.'); notice.className = 'notice';
 const form = el('form'); form.setAttribute('method', 'dialog'); form.setAttribute('novalidate', ''); form.setAttribute('aria-label', 'Emoji-only Unicode 17 spelling check');
 // No action, target or named controls: no GET/POST request target or serializable field.
 const fields = el('fieldset'), label = el('label'), caption = el('span', 'Emoji spelling'), input = el('textarea'), button = el('button', 'Check spelling'), status = el('p', 'Loading the local emoji spelling checker…');
 // A multiline control avoids a single-line input silently deleting pasted line breaks.
 input.setAttribute('rows', '2'); input.setAttribute('maxlength', String(MAX_INPUT_CODE_UNITS)); input.setAttribute('inputmode', 'text'); input.setAttribute('enterkeyhint', 'done');
 input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off'); input.setAttribute('spellcheck', 'false'); input.setAttribute('aria-describedby', help.id);
 button.setAttribute('type', 'button'); status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
 label.appendChild(caption); label.appendChild(input); fields.appendChild(label); fields.appendChild(button); form.appendChild(fields);
 section.appendChild(title); section.appendChild(help); section.appendChild(notice); section.appendChild(form); section.appendChild(status);
 let destroyed = false, composing = false, runtime = null, initialized = false;
 const listeners = [];
 const on = (node, type, handler) => { node.addEventListener(type, handler); listeners.push([node, type, handler]); };
 const halt = event => { event.preventDefault(); event.stopPropagation(); };
 const stop = event => event.stopPropagation();
 const disable = () => { fields.disabled = true; input.disabled = true; button.disabled = true; form.setAttribute('aria-disabled', 'true'); };
 const enable = () => { fields.disabled = false; input.disabled = false; button.disabled = false; form.setAttribute('aria-disabled', 'false'); };
 const clearStale = () => { if (!destroyed && initialized) status.textContent = ''; };
 const internalFailure = () => { runtime = null; initialized = false; disable(); status.textContent = CHECKER_ERROR; };
 disable();
 let cancelStylesheet = () => {};
 const stylesheetReady = isolated ? new Promise((resolve, reject) => {
  cancelStylesheet = () => resolve(false);
  on(stylesheet, 'load', () => resolve(true));
  on(stylesheet, 'error', () => reject(new Error('Local checker stylesheet unavailable.')));
 }) : Promise.resolve(false);
 if (isolated) shadow.appendChild(stylesheet); shadow.appendChild(section);
 // Submission is NEVER used to trigger a check, including implicit/mobile/IME Enter.
 on(form, 'submit', event => halt(event));
 on(form, 'formdata', event => halt(event));
 on(input, 'input', event => { stop(event); clearStale(); });
 on(input, 'change', event => { stop(event); clearStale(); });
 on(input, 'compositionstart', event => { stop(event); composing = true; clearStale(); });
 on(input, 'compositionend', event => { stop(event); composing = false; clearStale(); });
 for (const type of ['keydown', 'keyup']) on(input, type, event => {
  // Do not cancel IME commit keystrokes. Any resulting form submit is still always blocked.
  const ime = composing || event.isComposing || event.keyCode === 229;
  if ((event.key === 'Enter' || event.keyCode === 13) && !ime) { halt(event); return; }
  stop(event);
 });
 for (const type of ['paste', 'copy', 'cut']) on(input, type, event => { stop(event); if (type !== 'copy') clearStale(); });
 on(button, 'click', event => {
  halt(event);
  if (destroyed || !initialized || composing || event.isComposing) return;
  status.textContent = '';
  const original = input.value;
  if (typeof original !== 'string' || original.length > MAX_INPUT_CODE_UNITS) { status.textContent = inputErrors.INVALID_INPUT; return; }
  try { status.textContent = describe(runtime.tokenizeEmojiLabel(original, { qualification: 'listed', presentation: 'emoji-test-only' }), original); }
  catch (error) {
   let message;
   try {
    if (runtime && error instanceof runtime.Emoji17Error) {
     const code = error.code;
     if (typeof code === 'string' && Object.hasOwn(inputErrors, code)) message = inputErrors[code];
    }
   } catch { /* Malformed trusted-runtime errors also fail this checker closed. */ }
   if (message) status.textContent = message; else internalFailure();
  }
 });
 container.appendChild(host); // The only insertion into the parent's existing DOM.
 const ready = (async () => {
  try {
   if (!isolated) throw new TypeError('Isolated component DOM is unavailable.');
   const [loaded] = await Promise.all([(async () => loadRuntime())(), stylesheetReady]); if (destroyed) return false;
   if (!loaded || typeof loaded.tokenizeEmojiLabel !== 'function' || typeof loaded.getDataInfo !== 'function' || typeof loaded.Emoji17Error !== 'function') throw new TypeError('Runtime API mismatch.');
   if (!loaded.Emoji17Error.prototype || typeof loaded.Emoji17Error.prototype !== 'object') throw new TypeError('Runtime error class mismatch.');
   const info = loaded.getDataInfo();
   if (!info || info.emojiVersion !== EXPECTED.emojiVersion || info.unicodeVersion !== EXPECTED.unicodeVersion) throw new TypeError('Runtime version mismatch.');
   runtime = loaded; initialized = true; enable(); status.textContent = 'Ready for an emoji-only Unicode 17 spelling check.'; return true;
  } catch { if (!destroyed) { runtime = null; initialized = false; disable(); status.textContent = INIT_ERROR; } return false; }
 })();
 return Object.freeze({ ready, destroy() {
  if (destroyed) return; destroyed = true; initialized = false; runtime = null; composing = false; cancelStylesheet(); disable(); input.value = ''; status.textContent = '';
  for (const [node, type, handler] of listeners) node.removeEventListener(type, handler);
  listeners.length = 0; host.remove();
 } });
}
