---
kind: fixed
audience: player
---
The Keys' Mangrove Boardwalk no longer drops you into oncoming traffic. Its steps down used to land you in the left lane of the Mangrove Reach, straight at the shuttles and RVs coming the other way; now the planks swing across the road at the end and set you down in your own lane, as the boat ramp does. The sandbar's exit onto Conch Row had the same fault and gets the same fix. In seeded test races, riders coming off the boardwalk now meet oncoming traffic no more often than riders on the main road. Only about the last 180 m of the boardwalk and 220 m of the sandbar move (up to 6 m, at the rejoin); the rest of the boardwalk, the sandbar and Unlisted Key stay where they were.

Under the hood: the road compiler now refuses a branch that rejoins in an oncoming lane, and a new test checks where every branch rejoin lands on every live network, map-data ones included. Seeded Keys races change. Done, not phone-verified.
