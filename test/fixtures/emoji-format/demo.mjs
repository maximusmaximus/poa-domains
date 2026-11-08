// ORIGINAL test-only local fixture wiring. No transport, storage, URL handling or telemetry.
import { mountEmojiFormatChecker } from '../../../web/emoji-format-checker.mjs';
const container = document.getElementById('emoji-format-checker');
mountEmojiFormatChecker(container);
