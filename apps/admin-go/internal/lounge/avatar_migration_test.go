package lounge

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestLoungeAvatarResolutionUpgradePreservesExistingProfiles(t *testing.T) {
	db := concurrentPolicyDB(t)
	schema, err := os.ReadFile("../migrations/022_lounge_profiles.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(schema)).Error; err != nil {
		t.Fatal(err)
	}
	user := policyUser(t, db)
	store := postgresProfiles{db: db}
	legacy := avatarProfile{ID: user, Avatar: avatarPicture(t, 48)}
	if err := store.Save(context.Background(), legacy); err != nil {
		t.Fatal(err)
	}
	embedded, err := os.ReadFile("../migrations/028_lounge_avatar_resolution.sql")
	if err != nil {
		t.Fatal(err)
	}
	upgrade, err := os.ReadFile("../../sql/20261101-lounge-avatar-resolution.sql")
	if err != nil {
		t.Fatal(err)
	}
	clean := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(string(upgrade), "BEGIN;", ""), "COMMIT;", ""))
	if clean != strings.TrimSpace(string(embedded)) {
		t.Fatal("avatar upgrade differs from bootstrap")
	}
	for range 2 {
		if err := db.Exec(string(upgrade)).Error; err != nil {
			t.Fatal(err)
		}
	}
	profiles, err := store.Read(context.Background(), []string{user})
	if err != nil || len(profiles) != 1 || profiles[0] != legacy {
		t.Fatal("upgrade changed the existing avatar", err)
	}
	if err := store.Save(context.Background(), avatarProfile{ID: user, Avatar: detailedAvatar(t)}); err != nil {
		t.Fatal("upgraded database rejected 128px avatar", err)
	}
}
