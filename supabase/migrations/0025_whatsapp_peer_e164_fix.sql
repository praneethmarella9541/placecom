-- Fix mistaken peer_e164 from pre-+91 normalization (+8489431508 → +918489431508).

update public.whatsapp_messages
set peer_e164 = '+91' || substring(peer_e164 from 2)
where length(peer_e164) = 11
  and peer_e164 ~ '^\+\d{10}$'
  and substring(peer_e164 from 2) ~ '^[6-9]\d{9}$'
  and peer_e164 not like '+91%';
