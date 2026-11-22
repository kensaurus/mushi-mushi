help her take photo - two phones, one camera, so the person in the photo can direct the shot

The problem: you hand your phone to someone, get back a photo with your head cut off, and both of you go "let me see… delete it". The person who cares about the framing is the one who can't see the screen.

What I built: one phone is the camera, the other shows its live view and sends directions. Tap "left" or "closer", tap a spot on the view, send a pose idea, then "Perfect! Take it!". The shot lands in a gallery only the two phones can open.

How it works, for the builders here:

- Expo / React Native on iOS and Android, plus a web build
- Live view is WebRTC peer to peer, with a TURN relay when the networks won't connect directly
- Pairing is a short code, a QR scan or an invite link that survives the store install
- Supabase for pairing, storage and the shared gallery

It's free to pair and shoot, no account, no ads. I'm the only developer.

https://kensaur.us/help-her-take-photo/?utm_source=reddit&utm_medium=post&utm_campaign=launch-2611-sideproject

I'd like to hear where the live view lags for you, and on what network.
