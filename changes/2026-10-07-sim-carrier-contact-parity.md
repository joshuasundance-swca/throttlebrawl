---
kind: fixed
audience: player
---
Carrier trucks now collide where their parts are drawn. A jump that clears the cab stays clear; a lower jump meets its roof, hood or fittings instead of passing through them. Slow contacts wobble and hard contacts crash by the usual closing-speed rule. Landing on a roof or deck holds the bike, and the existing U-turn gesture lets a stopped rider turn round and back off.

The moving carrier's lowered ramp now rises 2.4 m over its 5 m run, instead of 1.22 m. Its drawn ramp and riding surface match. The higher lip reaches the cab roof and lets an ordinary catch launch above the rack and roof light; the old ramp's trajectory could not clear the cab even at high speed once the cab was made physically solid.

For devs:
- Parked and moving carriers use separate physical footprints and heights for their roof, hood and smaller fittings. The tallest exhaust stack no longer makes the whole cab an invisible box. Broad roof/hood surfaces can support a bike; narrow stacks and lamps cannot.
- Contacts use the vehicle rule's normal closing speed, including the carrier's and a supported rider's motion. Lip speed no longer grants immunity, and riding into the cab from a deck no longer forces a crash at every speed.
- A continuous rear ramp remains rideable at high speed. Side entries and vertical steps still meet solid obstacles.
- Tests compare physical heights with raycasts of the committed parked model and moving figure, check strict cab overlap at formerly immune speeds, preserve genuinely clear jumps, exercise ordinary moving-carrier jumps, retain a vertical-step control, and turn a stopped supported rider back off the truck.
- Recordings involving carrier contacts, moving ramps or supported U-turns can replay differently. No new state or random draw.
- Not phone-verified.
