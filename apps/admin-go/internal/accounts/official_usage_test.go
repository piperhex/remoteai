package accounts

import (
	"math"
	"testing"
)

func usagePtr[T any](value T) *T { return &value }
func usagePoint(ts int64, value float64) quotaObservation {
	return quotaObservation{Ts: ts, Primary: usagePtr(value), PrimaryReset: usagePtr[int64](1000)}
}

func TestQuotaDeclineCapacityAndRemaining(t *testing.T) {
	points := mergeQuotaObservations([]quotaObservation{usagePoint(120, 80), usagePoint(180, 60), usagePoint(180, 60)})
	phase := latestQuotaDecline(points, primaryQuota)
	// Boundary requests are excluded at the opening observation and included at the closing observation.
	addMinuteToDecline(phase, usageMinute{Ts: 120, Samples: [][3]float64{{0, 100, 99}, {30, 100, 2}}})
	addMinuteToDecline(phase, usageMinute{Ts: 180, Samples: [][3]float64{{0, 200, 4}}})
	estimate := estimateQuotaDecline(*phase, 200)
	if phase.DeclinePercent != 20 || phase.ConsumedUSD != 6 || *estimate.CapacityUSD != 30 || *estimate.RemainingUSD != 18 {
		t.Fatalf("wrong calibration: %+v / %+v", phase, estimate)
	}
	addMinuteToDecline(phase, usageMinute{Ts: 180, Samples: [][3]float64{{10, 100, 1}}})
	if got := estimateQuotaDecline(*phase, 200); got.ConsumedUSD != 7 ||
		*got.CapacityUSD != 35 || *got.RemainingUSD != 21 {
		t.Fatal(got)
	}
}

func TestQuotaDeclineStageBoundaries(t *testing.T) {
	cases := []struct {
		name   string
		points []quotaObservation
		start  int64
		drop   float64
	}{
		{"rebound", []quotaObservation{usagePoint(100, 80), usagePoint(200, 60), usagePoint(300, 90), usagePoint(400, 85)}, 300, 5},
		{"plateau", []quotaObservation{usagePoint(100, 80), usagePoint(200, 80), usagePoint(300, 60)}, 100, 20},
		{"missing", []quotaObservation{usagePoint(100, 80), {Ts: 200}, usagePoint(300, 60)}, 100, 20},
		{"reset changed", []quotaObservation{usagePoint(100, 80),
			{Ts: 200, Primary: usagePtr(60.0), PrimaryReset: usagePtr[int64](2000)}}, 100, 20},
		{"reset crossed", []quotaObservation{usagePoint(100, 80), usagePoint(1100, 60)}, 100, 20},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got := latestQuotaDecline(test.points, primaryQuota)
			if got.StartTs != test.start || got.DeclinePercent != test.drop {
				t.Fatal(got)
			}
		})
	}
}

func TestFlatObservationKeepsBaselineAndAccumulatesCost(t *testing.T) {
	phase := latestQuotaDecline([]quotaObservation{
		usagePoint(120, 80), usagePoint(180, 60), usagePoint(240, 60),
	}, primaryQuota)
	addMinuteToDecline(phase, usageMinute{Ts: 120, Samples: [][3]float64{{30, 100, 6}}})
	addMinuteToDecline(phase, usageMinute{Ts: 180, Samples: [][3]float64{{30, 100, 1}}})
	addMinuteToDecline(phase, usageMinute{Ts: 240, Samples: [][3]float64{{30, 100, 1}}})
	estimate := estimateQuotaDecline(*phase, 300)
	if phase.StartTs != 120 || phase.EndTs != 240 || estimate.ConsumedUSD != 8 ||
		*estimate.CapacityUSD != 40 || *estimate.RemainingUSD != 24 {
		t.Fatal("costs must accumulate without moving the initial observation", phase, estimate)
	}
}

func TestQuotaWaitsForDropAndRestartsOnlyOnIncrease(t *testing.T) {
	points := []quotaObservation{usagePoint(100, 80), usagePoint(200, 80)}
	phase := latestQuotaDecline(points, primaryQuota)
	addMinuteToDecline(phase, usageMinute{Ts: 120, Samples: [][3]float64{{30, 100, 6}}})
	if estimate := estimateQuotaDecline(*phase, 250); estimate.CapacityUSD != nil || estimate.RemainingUSD != nil {
		t.Fatal("a flat baseline cannot calibrate a quota", estimate)
	}
	points = append(points, usagePoint(300, 60), usagePoint(400, 70), usagePoint(500, 65))
	phase = latestQuotaDecline(points, primaryQuota)
	addMinuteToDecline(phase, usageMinute{Ts: 120, Samples: [][3]float64{{30, 100, 6}}})
	addMinuteToDecline(phase, usageMinute{Ts: 420, Samples: [][3]float64{{30, 100, 2}}})
	estimate := estimateQuotaDecline(*phase, 600)
	if phase.StartTs != 400 || *phase.StartRemaining != 70 || phase.DeclinePercent != 5 ||
		estimate.ConsumedUSD != 2 || *estimate.CapacityUSD != 40 || *estimate.RemainingUSD != 26 {
		t.Fatal("an increase must start a new cost and percentage baseline", phase, estimate)
	}
}

func TestOfficialUsageRejectsLegacyReports(t *testing.T) {
	report := officialUsageReport{Version: officialUsageVersion, DeviceName: "Desktop"}
	if !validUsageReport(report, "desktop", 200) {
		t.Fatal("current version rejected")
	}
	for _, version := range []int{0, 1, officialUsageVersion + 1} {
		report.Version = version
		if validUsageReport(report, "desktop", 200) {
			t.Fatal("unsupported statistics version accepted", version)
		}
	}
}

func TestQuotaMissingConflictsAndExhaustion(t *testing.T) {
	conflicting := mergeQuotaObservations([]quotaObservation{usagePoint(200, 60), usagePoint(200, 50)})
	if got := latestQuotaDecline(conflicting, primaryQuota); got == nil || got.Remaining != nil {
		t.Fatal("a conflicting window must remain present even without earlier observations", got)
	}
	points := []quotaObservation{usagePoint(100, 80), usagePoint(200, 60), usagePoint(200, 50)}
	phase := latestQuotaDecline(mergeQuotaObservations(points), primaryQuota)
	if phase.Remaining != nil || phase.StartTs != 100 || *phase.StartRemaining != 80 {
		t.Fatal("conflicting observations must invalidate the window")
	}
	if latestQuotaDecline(points, secondaryQuota) != nil {
		t.Fatal("nonexistent window should be omitted")
	}
	phase = latestQuotaDecline([]quotaObservation{usagePoint(100, 0)}, primaryQuota)
	exhausted := estimateQuotaDecline(*phase, 200)
	if exhausted.RemainingUSD == nil || *exhausted.RemainingUSD != 0 {
		t.Fatal(exhausted)
	}
	if estimateQuotaDecline(*phase, 1000).RemainingUSD != nil {
		t.Fatal("expired quota is unknown")
	}
	known := &quotaEstimate{RemainingUSD: usagePtr(18.0)}
	if availableOfficialQuota(known, &quotaEstimate{}) != nil {
		t.Fatal("missing active window must not be ignored")
	}
	if *availableOfficialQuota(known, &quotaEstimate{RemainingUSD: usagePtr(12.0)}) != 12 {
		t.Fatal("must use lower quota")
	}
	if *availableOfficialQuota(&quotaEstimate{}, &exhausted) != 0 {
		t.Fatal("exhaustion is definitive")
	}
}

func TestOfficialUsageValidation(t *testing.T) {
	valid := usageMinute{Ts: 120, Samples: [][3]float64{{0, 100, 1}, {59, 100, 1}}}
	if !validUsageMinute(valid, 200) {
		t.Fatal("valid minute rejected")
	}
	for _, sample := range [][3]float64{{-1, 1, 1}, {60, 1, 1}, {0, 1.5, 1}, {0, 1, -1}, {math.NaN(), 1, 1}, {0, 1, math.Inf(1)}} {
		if validUsageMinute(usageMinute{Ts: 120, Samples: [][3]float64{sample}}, 200) {
			t.Fatal(sample)
		}
	}
	if validUsageMinute(valid, 150) {
		t.Fatal("future sample accepted")
	}
	if validUsageMinute(usageMinute{Ts: 120}, 200) {
		t.Fatal("empty bucket accepted")
	}
}
