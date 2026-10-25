import { bypassLogin } from "./battle-scene";
import * as Utils from "./utils";
import { readLocalSave, sessionSaveKey } from "./system/local-save-store";

export interface UserInfo {
  username: string;
  lastSessionSlot: integer;
}

export let loggedInUser: UserInfo = null;

export function updateUserInfo(readSave: (key: string) => Promise<string | null> = readLocalSave, username = 'Local'): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    if (bypassLogin) {
      (async () => {
        let lastSessionSlot = -1;
        for (let s = 0; s < 3; s++) {
          if (await readSave(sessionSaveKey(s))) {
            lastSessionSlot = s;
            break;
          }
        }
        loggedInUser = { username, lastSessionSlot };
        resolve(true);
      })().catch(reject);
      return;
    }
    Utils.apiFetch('account/info').then(response => {
      if (!response.ok) {
        loggedInUser = null;
        resolve(false);
        return;
      }
      return response.json();
    }).then(jsonResponse => {
      loggedInUser = jsonResponse;
      resolve(true);
    });
  });
}
