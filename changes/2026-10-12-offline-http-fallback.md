---
kind: fixed
audience: player
---
An installed game now opens its cached copy when the host answers with an error page, including a temporary 503 outage. A healthy network response still brings you the latest game.

Developer checks cover error responses with and without cached content, healthy-update priority and cached startup when the network hangs. Race restoration after a page reload remains separate work.
