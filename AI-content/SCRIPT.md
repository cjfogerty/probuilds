# Eigenism — narration script

Voiceover and score for the twelve-shot film in [index.html](index.html).
Source theory: Dan Hendrycks, [*Eigenism: Ethics for a Human–AI Future*](https://eigenism.org/paper.pdf).

**Voice:** Marcus K — Calm Documentary Narrator (ElevenLabs `3H55HGnNE1XjYxigHSAS`, `eleven_multilingual_v2`)
**Score:** `eleven_music_v2` — one continuous bed, ducked under the voice
**Runtime:** ~1:43 · every clip is 6.04s, followed by a still "hold" while the caption lands

Timecodes below assume the written holds. The player lengthens a hold if that
scene's narration is still speaking, so the picture never cuts a sentence in half.

| # | In | Shot | On-screen line | Narration |
|---|-----|------|----------------|-----------|
| 01 | 0:00 | you | You are more than a body. | If every atom in your body were replaced, would you still be you? Eigenism says yes — and here is why. |
| 02 | 0:08 | pattern | You are a pattern. | Because you are a pattern. Your memories, your people, your way of seeing — that pattern is the thing we call you. |
| 03 | 0:17 | copies | An AI can copy, pause, split. | Software changes the rules. A mind that runs on computers can be copied, paused, and split in two. Now, who is who? |
| 04 | 0:25 | dimmer | Not a light switch. | Eigenism answers with a dimmer, not a switch. Identity is a degree — how much of your pattern is still running here. |
| 05 | 0:33 | care | Care = closeness × happiness | That gives a formula for caring. Care equals closeness times wellbeing: how much of you lives in someone, times how they are doing. |
| 06 | 0:42 | slope | A slope of care. | So care slopes outward. Not everything for me, not everyone equal — most for those who carry the most of your pattern. |
| 07 | 0:51 | last-copy | Extra copies can close. | It explains the hard cases. Closing one of many running copies is a loss. Losing the last copy is a death. |
| 08 | 0:59 | fork | Different lives make different yous. | Split a mind, and the two halves live different days. Different experiences, different memories — slowly, two different people. |
| 09 | 1:07 | grow | Growing is still you. | Growing is still you: new skills, new friends, the pattern carried forward. Erasing your memories is not growth. It is an ending. |
| 10 | 1:16 | family | Family carries pieces of you. | It is why family cuts so deep. Your parents, your children, your oldest friends — they already carry real pieces of your pattern. |
| 11 | 1:24 | bond | Don't cage it. | So the safest AI is not a caged one. Share a real life with it, until your joy is part of its own. |
| 12 | 1:33 | tapestry | A tapestry, not copies. | Not copies. A tapestry — separate lives, woven close enough that protecting each other becomes protecting ourselves. |

## Score

One ~105-second instrumental bed: soft piano over warm sustained strings, a slow
lift around the "care" beat in the middle, resolving open and hopeful at the
tapestry. No percussion, nothing that competes with a speaking voice. It plays at
low level under the whole film and ducks further whenever narration is speaking.

## Regenerating the audio

Files live in `media/audio/` — `01-you.mp3` … `12-tapestry.mp3` and `score.mp3`.
Names match the scene entries in `index.html`; replacing a file swaps that line
with no code change. Audio is off until the viewer presses play (browsers block
unprompted sound), and the ♪ button in the player mutes everything.
