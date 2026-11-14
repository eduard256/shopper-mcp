import { config } from '../config.js';

// Advice for the user when a site shows a captcha: settings that make the browser look less automated.
const captchaRules = [
  {
    when: () => process.platform === 'linux' && !process.env.TZ,
    text: 'Set the TZ environment variable to your time zone (e.g. TZ=Europe/Berlin): the browser now runs in UTC.',
  },
  {
    when: () => process.platform === 'linux' && !config.locale,
    text: 'Set SHOPPER_LOCALE to your language (e.g. SHOPPER_LOCALE=de-DE): the browser now uses the server default.',
  },
];

export function captchaHints(): string[] {
  return captchaRules.filter((rule) => rule.when()).map((rule) => rule.text);
}
