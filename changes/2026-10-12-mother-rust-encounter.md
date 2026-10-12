---
kind: changed
audience: player
---
Mother Rust's Drawbridge finale has a longer preparation before she rams across your line. Once she commits, a late dodge can leave her crossing the line you just left. Her recovery gives you a brief chance to pass before she gets back on the throttle. Her preparation, ram and recovery have different riding poses, and punches and kicks keep their own animations.

For devs: the tactic is limited to the existing named grudge finale and ram rider. It uses ordinary steering, braking, target acquisition and navigation priorities. Ordinary races retain the existing ram timing and live target tracking. Focused tests cover selected timing, commitment, contact and timer recovery, target loss and interruption scheduling, physical slowing, a passing opportunity, throttle resumption and replay hashes. Geometry tests use fixture parts on the production rig path; they do not verify the shipped models' pixels. The authored career probe checks a player-targeted ram using a bounded seed search, without moving riders or forcing acquisition. Career scoring, progression and rewards are unchanged. Not phone-verified.
