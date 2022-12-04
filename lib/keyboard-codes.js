"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEY_CODE = exports.KEY_MOD = void 0;
/**
 * Modifier masks - used for the first byte in the HID report.
 * NOTE: The second byte in the report is reserved, 0x00
 * https://gist.github.com/MightyPork/6da26e382a7ad91b5496ee55fdc73db2
 */
var KEY_MOD;
(function (KEY_MOD) {
    KEY_MOD[KEY_MOD["LCTRL"] = 1] = "LCTRL";
    KEY_MOD[KEY_MOD["LSHIFT"] = 2] = "LSHIFT";
    KEY_MOD[KEY_MOD["LALT"] = 4] = "LALT";
    KEY_MOD[KEY_MOD["LMETA"] = 8] = "LMETA";
    KEY_MOD[KEY_MOD["RCTRL"] = 16] = "RCTRL";
    KEY_MOD[KEY_MOD["RSHIFT"] = 32] = "RSHIFT";
    KEY_MOD[KEY_MOD["RALT"] = 64] = "RALT";
    KEY_MOD[KEY_MOD["RMETA"] = 128] = "RMETA";
})(KEY_MOD = exports.KEY_MOD || (exports.KEY_MOD = {}));
/**
 * Scan codes - last N slots in the HID report (usually 6).
 * 0x00 if no key pressed.
 *
 * If more than N keys are pressed, the HID reports
 * KEY_ERR_OVF in all slots to indicate this condition.
 * https://gist.github.com/MightyPork/6da26e382a7ad91b5496ee55fdc73db2
 * https://gist.github.com/Crenshinibon/5238119
 * https://git.sr.ht/~sircmpwn/hare-sdl2/tree/7855e717d6af1b4f1e9ed15b7db9bda6686da954/item/sdl2/keyboard.ha
 */
var KEY_CODE;
(function (KEY_CODE) {
    KEY_CODE[KEY_CODE["NONE"] = 0] = "NONE";
    KEY_CODE[KEY_CODE["ENTER"] = 40] = "ENTER";
    KEY_CODE[KEY_CODE["ESC"] = 41] = "ESC";
    KEY_CODE[KEY_CODE["BACKSPACE"] = 42] = "BACKSPACE";
    KEY_CODE[KEY_CODE["TAB"] = 43] = "TAB";
    KEY_CODE[KEY_CODE["SPACE"] = 44] = "SPACE";
    KEY_CODE[KEY_CODE["NUMLOCK"] = 83] = "NUMLOCK";
    KEY_CODE[KEY_CODE["KPSLASH"] = 84] = "KPSLASH";
    KEY_CODE[KEY_CODE["KPASTERISK"] = 85] = "KPASTERISK";
    KEY_CODE[KEY_CODE["KPMINUS"] = 86] = "KPMINUS";
    KEY_CODE[KEY_CODE["KPPLUS"] = 87] = "KPPLUS";
    KEY_CODE[KEY_CODE["KPENTER"] = 88] = "KPENTER";
    KEY_CODE[KEY_CODE["KP1"] = 89] = "KP1";
    KEY_CODE[KEY_CODE["KP2"] = 90] = "KP2";
    KEY_CODE[KEY_CODE["KP3"] = 91] = "KP3";
    KEY_CODE[KEY_CODE["KP4"] = 92] = "KP4";
    KEY_CODE[KEY_CODE["KP5"] = 93] = "KP5";
    KEY_CODE[KEY_CODE["KP6"] = 94] = "KP6";
    KEY_CODE[KEY_CODE["KP7"] = 95] = "KP7";
    KEY_CODE[KEY_CODE["KP8"] = 96] = "KP8";
    KEY_CODE[KEY_CODE["KP9"] = 97] = "KP9";
    KEY_CODE[KEY_CODE["KP0"] = 98] = "KP0";
    KEY_CODE[KEY_CODE["KPDOT"] = 99] = "KPDOT";
})(KEY_CODE = exports.KEY_CODE || (exports.KEY_CODE = {}));
