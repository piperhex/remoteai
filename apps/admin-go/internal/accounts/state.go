package accounts

import (
	"regexp"
	"sort"

	"github.com/codex-switch/admin-go/internal/platform"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

var deviceIDPattern = regexp.MustCompile(
	`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
)

// EffectiveAccounts returns current personal accounts with bound official accounts taking precedence.
func EffectiveAccounts(deps *platform.Dependencies, ownerID string) ([]map[string]interface{}, error) {
	s := &service{deps: deps}
	result, err := s.effective(ownerID)
	if err != nil {
		return nil, err
	}
	return result["accounts"].([]object), nil
}

// SyncedProviders returns active provider credentials for authenticated device operations.
func SyncedProviders(deps *platform.Dependencies, ownerID string) ([]map[string]interface{}, error) {
	s := &service{deps: deps}
	result, err := s.providers(ownerID)
	if err != nil {
		return nil, err
	}
	return result["providers"].([]object), nil
}

func (s *service) boundAccounts(owner string) ([]systemAccount, error) {
	rows := []systemAccount{}
	err := s.deps.DB.Table("system_accounts").Select("system_accounts.*").
		Joins(`JOIN system_account_bindings b ON b."systemAccountId" = system_accounts.id`).
		Where(`b."userId" = ?`, owner).Find(&rows).Error
	return rows, err
}

func systemSyncDTO(row systemAccount) object {
	return object{
		"id":                  row.SyncAccountID,
		"email":               row.Email,
		"note":                row.Note,
		"expiresAt":           row.ExpiresAt,
		"plan":                row.Plan,
		"accountId":           row.CodexAccountID,
		"active":              false,
		"autoSwitchPriority":  0,
		"autoSwitchThreshold": 0,
		"usage":               obj(row.Usage),
		"lastModifiedAt":      iso(row.LastModifiedAt),
		"auth":                obj(row.Auth),
	}
}

func (s *service) effective(owner string) (object, error) {
	rows := []account{}
	if err := s.deps.DB.Where(`"ownerId" = ?`, owner).Order("email ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	bound, err := s.boundAccounts(owner)
	if err != nil {
		return nil, err
	}
	effective := map[string]object{}
	deleted := map[string]bool{}
	personal := map[string]account{}
	for _, row := range rows {
		personal[row.AccountID] = row
		if row.DeletedAt != nil {
			deleted[row.AccountID] = true
			continue
		}
		dto := accountDTO(row)
		dto["official"] = false
		dto["metadataEditable"] = true
		effective[row.AccountID] = dto
	}
	for _, row := range bound {
		dto := systemSyncDTO(row)
		private := accountDTO(personal[row.SyncAccountID])
		if has(private, "privateDetails") {
			dto["privateDetails"] = private["privateDetails"]
			v := versions(nil, dto["lastModifiedAt"], accountFields)
			v["privateDetails"] = obj(private["fieldModifiedAt"])["privateDetails"]
			dto["fieldModifiedAt"] = v
			dto["lastModifiedAt"] = latest(v)
		}
		dto["official"] = true
		dto["metadataEditable"] = false
		effective[row.SyncAccountID] = dto
		delete(deleted, row.SyncAccountID)
	}
	items := []object{}
	for _, row := range effective {
		items = append(items, row)
	}
	sortAccounts(items)
	deletedIDs := []string{}
	for id := range deleted {
		deletedIDs = append(deletedIDs, id)
	}
	sort.Strings(deletedIDs)
	return object{"accounts": items, "deletedAccountIds": deletedIDs}, nil
}

func sortAccounts(items []object) {
	comparator := collate.New(language.English)
	sort.SliceStable(items, func(i, j int) bool {
		return comparator.CompareString(str(items[i]["email"]), str(items[j]["email"])) < 0
	})
}

func (s *service) list(owner, device string, editable bool) (interface{}, error) {
	result, err := s.effectiveCached(owner)
	if err != nil {
		return nil, err
	}
	activeID := ""
	useDevice := deviceIDPattern.MatchString(device)
	if useDevice {
		row := struct {
			ActiveAccountID string `gorm:"column:activeAccountId"`
		}{}
		err = s.deps.DB.Table("remote_devices").
			Where(`"ownerId" = ? AND "deviceId" = ?`, owner, device).
			Limit(1).
			Find(&row).
			Error
		if err != nil {
			return nil, err
		}
		activeID = row.ActiveAccountID
	}
	for _, row := range result["accounts"].([]object) {
		row["metadataEditable"] = row["official"] != true || editable
		if useDevice {
			row["active"] = row["id"] == activeID
		}
	}
	return result, nil
}

func mobile(row object) object {
	result := copyObject(row)
	delete(result, "auth")
	if token := str(obj(obj(row["auth"])["tokens"])["access_token"]); token != "" {
		result["codexAccessToken"] = token
	}
	return result
}

func (s *service) summary(owner string, editable, web bool) (interface{}, error) {
	result, err := s.effectiveCached(owner)
	if err != nil {
		return nil, err
	}
	items := []object{}
	for _, row := range result["accounts"].([]object) {
		if web {
			delete(row, "auth")
			delete(row, "privateDetails")
			row["source"] = "personal"
			if row["official"] == true {
				row["source"] = "system"
			}
			delete(row, "official")
			delete(row, "metadataEditable")
			items = append(items, row)
			continue
		}
		row["metadataEditable"] = row["official"] != true || editable
		items = append(items, mobile(row))
	}
	return object{"accounts": items}, nil
}

func (s *service) effectiveByID(owner, id string) (object, error) {
	data, err := s.effective(owner)
	if err != nil {
		return nil, err
	}
	for _, row := range data["accounts"].([]object) {
		if row["id"] == id {
			return row, nil
		}
	}
	return nil, platform.NewError(404, "Synced account not found")
}

func (s *service) details(owner, id string) (interface{}, error) {
	row, err := s.cachedAccount(owner, id)
	if err != nil {
		return nil, err
	}
	result := mobile(row)
	delete(result, "codexAccessToken")
	result["source"] = "personal"
	if result["official"] == true {
		result["source"] = "system"
	}
	delete(result, "official")
	return result, nil
}

type writeOptions struct {
	Owner, Device            string
	Editable, RejectMetadata bool
}

func (s *service) updateDetails(options writeOptions, id string, patch object) (interface{}, error) {
	if err := normalizeAccountAlias(obj(patch["privateDetails"])); err != nil {
		return nil, err
	}
	row, err := s.effectiveByID(options.Owner, id)
	if err != nil {
		return nil, err
	}
	v := versions(obj(row["fieldModifiedAt"]), row["lastModifiedAt"], accountFields)
	modified := iso(now())
	patch["privateDetails"] = preserveAccountAlias(obj(patch["privateDetails"]), obj(row["privateDetails"]))
	for _, key := range []string{"note", "expiresAt", "privateDetails"} {
		row[key] = valueOr(patch[key], fieldDefault(key))
		v[key] = modified
	}
	row["fieldModifiedAt"] = v
	row["lastModifiedAt"] = modified
	options.RejectMetadata = true
	if _, err = s.upsertAccounts(options, []object{row}); err != nil {
		return nil, err
	}
	row, err = s.effectiveByID(options.Owner, id)
	if err != nil {
		return nil, err
	}
	return mobile(row), nil
}

func (s *service) listAdmin(owner string, portal, editable bool) (interface{}, error) {
	rows := []account{}
	if err := s.deps.DB.Where(`"ownerId" = ? AND "deletedAt" IS NULL`, owner).Find(&rows).Error; err != nil {
		return nil, err
	}
	bound, err := s.boundAccounts(owner)
	if err != nil {
		return nil, err
	}
	pool := []systemAccount{}
	ids := []string{}
	for _, row := range rows {
		ids = append(ids, row.AccountID)
	}
	if len(ids) > 0 {
		if err = s.deps.DB.Where(`"syncAccountId" IN ?`, ids).Find(&pool).Error; err != nil {
			return nil, err
		}
	}
	pooled := map[string]bool{}
	for _, row := range pool {
		pooled[row.SyncAccountID] = true
	}
	effective := map[string]object{}
	for _, row := range rows {
		dto := accountDTO(row)
		delete(dto, "privateDetails")
		dto["source"] = "personal"
		dto["inSystemPool"] = pooled[row.AccountID]
		effective[row.AccountID] = dto
	}
	for _, row := range bound {
		dto := systemSyncDTO(row)
		dto["source"] = "system"
		dto["systemAccountId"] = row.ID
		dto["inSystemPool"] = true
		effective[row.SyncAccountID] = dto
	}
	items := []object{}
	for _, dto := range effective {
		if portal {
			delete(dto, "auth")
			dto["metadataEditable"] = dto["source"] != "system" || editable
		}
		items = append(items, dto)
	}
	sortAccounts(items)
	return object{"accounts": items}, nil
}
