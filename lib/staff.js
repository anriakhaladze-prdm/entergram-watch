import staffConfig from '../config/staff.json' with { type: 'json' };

export const STAFF_IDS = new Set(staffConfig.staff.map((s) => String(s.telegramUserId)));
export const BOT_IDS = new Set((staffConfig.bots || []).map((s) => String(s.telegramUserId)));
export const STAFF_BY_ID = new Map(staffConfig.staff.map((s) => [String(s.telegramUserId), s]));

export const isStaff = (id) => id != null && STAFF_IDS.has(String(id));

// Second line of defence for staff whose id is not in the roster yet, for
// example a new host. Every host's Telegram display name follows the same
// convention: "Kyle | Thrill VIP", "Mikey | Thrill Affiliate", "High Priest -
// Thrill.com". The separator is required, so a player calling themselves
// something like thrillseeker does not match.
const STAFF_NAME = /[|\-\u2013\u2014]\s*thrill/i;
export const isStaffName = (name) => Boolean(name && STAFF_NAME.test(name));
export const looksStaff = (id, name) => isStaff(id) || isStaffName(name);
export const isBot = (id) => id != null && BOT_IDS.has(String(id));
// Anyone who is neither staff nor a service account is the player side of the
// conversation. Treating unknown senders as players is the safe default: it
// can delay an alert, never invent one.
export const isPlayerSide = (id) => id != null && !isStaff(id) && !isBot(id);

export const staffName = (id) => STAFF_BY_ID.get(String(id))?.name || null;
export const staffList = staffConfig.staff;
