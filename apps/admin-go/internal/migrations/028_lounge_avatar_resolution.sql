-- 80 KiB PNG payload, base64 encoded, plus the data URL prefix.
ALTER TABLE lounge_profiles DROP CONSTRAINT IF EXISTS lounge_profile_avatar_size;
ALTER TABLE lounge_profiles ADD CONSTRAINT lounge_profile_avatar_size
    CHECK (octet_length(avatar) <= 109250);
