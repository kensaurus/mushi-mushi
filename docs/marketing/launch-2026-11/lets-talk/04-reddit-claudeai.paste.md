I built a conversation rehearsal app on Claude where the other person is supposed to push back. Free to try in the browser.

What it is: lets-talk lets you practise a hard conversation before you have it. You pick a scene (a roommate who never does the dishes, asking your manager for a raise, an apology you owe) and talk it through with a character Claude plays. A meter shows the conversation heating or cooling, and after each turn a coach note says what landed.

How Claude is used:

- Role-play: Claude plays the other person, with a starting tension and a private trait sheet from the scene setup. Every turn it answers on two channels: the chat reply stays fully in character, and a tool call (reportMood) carries the mood change, which of the four parts you used, and the coach note. The meter and the coach note come from the tool call, so the character never has to step out of the scene to coach you. One rule in the prompt keeps it realistic: "Healing is gradual — don't instantly go to zero after one good line."
- Write: you draft what you'd say, and Claude scores it on the four parts of Nonviolent Communication (what happened, how you feel, what you need, a request). The score comes back as structured fields, so the UI fills in each part as it arrives instead of waiting for one long reply.
- Advise: paste a message that froze you, and Claude shows how it might read from their side and drafts a few replies.

Bring your own key if you like: in Settings you can paste an Anthropic key (it stays in your browser) and pick Opus 5, Sonnet 5 or Haiku 4.5. Without a key, there's a guest allowance per device, no account needed.

Before anything leaves your device, it shows what is sent to Anthropic and asks for your OK. Nothing is stored on my servers.

Free to try, with optional paid plans in the app: https://talk.kensaur.us/?utm_source=reddit&utm_medium=post&utm_campaign=launch-2611-claudeai

I'd like to hear from anyone who has tried to make Claude play a difficult character: how do you stop it from being agreeable by the second turn?
