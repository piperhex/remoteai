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
	if got := estimateQuotaDecline(*phase, 200); *got.RemainingUSD != 17 {
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
		{"missing", []quotaObservation{usagePoint(100, 80), {Ts: 200}, usagePoint(300, 60)}, 300, 0},
		{"reset changed", []quotaObservation{usagePoint(100, 80),
			{Ts: 200, Primary: usagePtr(60.0), PrimaryReset: usagePtr[int64](2000)}}, 200, 0},
		{"reset crossed", []quotaObservation{usagePoint(100, 80), usagePoint(1100, 60)}, 1100, 0},
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

func TestFlatObservationDoesNotInflateCalibratedCapacity(t *testing.T) {
	phase := latestQuotaDecline([]quotaObservation{
		usagePoint(120, 80), usagePoint(180, 60), usagePoint(240, 60),
	}, primaryQuota)
	addMinuteToDecline(phase, usageMinute{Ts: 120, Samples: [][3]float64{{30, 100, 6}}})
	addMinuteToDecline(phase, usageMinute{Ts: 180, Samples: [][3]float64{{30, 100, 1}}})
	estimate := estimateQuotaDecline(*phase, 300)
	if phase.EndTs != 180 || *estimate.CapacityUSD != 30 || *estimate.RemainingUSD != 17 {
		t.Fatal("flat observations inflated the estimate", phase, estimate)
	}
}

func TestQuotaMissingConflictsAndExhaustion(t *testing.T) {
	conflicting := mergeQuotaObservations([]quotaObservation{usagePoint(200, 60), usagePoint(200, 50)})
	if got := latestQuotaDecline(conflicting, primaryQuota); got == nil || got.Remaining != nil {
		t.Fatal("a conflicting window must remain present even without earlier observations", got)
	}
	points := []quotaObservation{usagePoint(100, 80), usagePoint(200, 60), usagePoint(200, 50)}
	phase := latestQuotaDecline(mergeQuotaObservations(points), primaryQuota)
	if phase.Remaining != nil {
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
