---
kind: dev
audience: dev
---
A small wire for dev-3's debug file. Each race now records with the full replay header (the race's settings as plain data), and the recording is closed with its final state hash when the race ends, so a saved debug file can replay on its own. The app hands dev/ the encoded recording (`replayFile()`) and a way to replay one against a fresh race and compare hashes (`checkReplay()`), so dev/ never imports the replay module. The pause screen's "Save debug file" button shows once the entry point passes `onSaveDebugFile`.
