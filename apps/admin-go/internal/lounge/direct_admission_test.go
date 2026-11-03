package lounge

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestEstablishedDirectAdmissionDoesNotLockAndStillChecksReset(t *testing.T) {
	db := concurrentPolicyDB(t)
	a, b := policyUser(t, db), policyUser(t, db)
	h := newHub(nil)
	h.directKey = []byte("test-key")
	opening, err := h.directPermission(a, incoming{ID: "opening", To: b, Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	reply, err := h.directPermission(b, incoming{ID: "reply", To: a, Text: "reply"})
	if err != nil {
		t.Fatal(err)
	}
	repo := postgresDirectPolicy{db: db}
	for _, request := range []directPermission{opening, reply} {
		if _, err := repo.AdmitMessage(t.Context(), request); err != nil {
			t.Fatal(err)
		}
	}
	lock := db.Begin()
	if lock.Error != nil {
		t.Fatal(lock.Error)
	}
	defer lock.Rollback()
	if err := lock.Exec(`SELECT generation FROM lounge_direct_permissions
 WHERE first_user=? AND second_user=? FOR UPDATE`, opening.FirstUser, opening.SecondUser).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	admission, err := repo.AdmitMessage(ctx, opening)
	if err != nil || admission.Changed {
		t.Fatal("established message waited for a write lock", admission, err)
	}
	if err := lock.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	generation, err := repo.Reset(t.Context(), opening)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AdmitMessage(t.Context(), opening); !errors.Is(err, errDirectReset) {
		t.Fatal("reset bypassed", err)
	}
	opening.Generation = generation
	admission, err = repo.AdmitMessage(t.Context(), opening)
	if err != nil || !admission.Changed {
		t.Fatal("new generation was not announced", admission, err)
	}
	opening.Fingerprint = strings.Repeat("b", 64)
	if _, err := repo.AdmitMessage(t.Context(), opening); !errors.Is(err, errAwaitingReply) {
		t.Fatal("opening limit bypassed", err)
	}
}
