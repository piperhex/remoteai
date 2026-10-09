package accounts

import (
	"math"
	"sort"
)

type quotaWindow string

const primaryQuota quotaWindow = "primary"
const secondaryQuota quotaWindow = "secondary"
const minimumQuotaDrop = 0.000001

// Store the original levels as well as their difference so a decline can be audited and recalculated.
type quotaDecline struct {
	StartTs        int64
	EndTs          int64
	StartRemaining *float64
	Remaining      *float64
	ResetAt        *int64
	DeclinePercent float64
	ConsumedUSD    float64 `gorm:"column:consumed_usd"`
	AfterUSD       float64 `gorm:"column:after_usd"`
}

type quotaEstimate struct {
	CapacityUSD      *float64 `json:"capacityUsd"`
	RemainingUSD     *float64 `json:"remainingUsd"`
	ConsumedUSD      float64  `json:"consumedUsd"`
	DeclinePercent   float64  `json:"declinePercent"`
	StartPercent     *float64 `json:"startPercent"`
	RemainingPercent *float64 `json:"remainingPercent"`
	StartTs          int64    `json:"startTs"`
	EndTs            int64    `json:"endTs"`
}

func quotaValues(point quotaObservation, window quotaWindow) (*float64, *int64) {
	if window == primaryQuota {
		return point.Primary, point.PrimaryReset
	}
	return point.Secondary, point.SecondaryReset
}

func equalQuotaValue[T comparable](left, right *T) bool {
	return (left == nil && right == nil) || (left != nil && right != nil && *left == *right)
}

func mergeQuotaObservations(points []quotaObservation) []quotaObservation {
	byTime := map[int64]quotaObservation{}
	for _, point := range points {
		point.PrimaryObserved = point.PrimaryObserved || point.Primary != nil
		point.SecondaryObserved = point.SecondaryObserved || point.Secondary != nil
		if previous, ok := byTime[point.Ts]; ok {
			point.PrimaryObserved = point.PrimaryObserved || previous.PrimaryObserved
			point.SecondaryObserved = point.SecondaryObserved || previous.SecondaryObserved
			if !equalQuotaValue(previous.Primary, point.Primary) || !equalQuotaValue(previous.PrimaryReset, point.PrimaryReset) {
				point.Primary = nil
			}
			if !equalQuotaValue(previous.Secondary, point.Secondary) || !equalQuotaValue(previous.SecondaryReset, point.SecondaryReset) {
				point.Secondary = nil
			}
		}
		byTime[point.Ts] = point
	}
	merged := make([]quotaObservation, 0, len(byTime))
	for _, point := range byTime {
		merged = append(merged, point)
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].Ts < merged[j].Ts })
	return merged
}

func latestQuotaDecline(points []quotaObservation, window quotaWindow) *quotaDecline {
	if len(points) == 0 {
		return nil
	}
	observed := false
	for _, point := range points {
		value, _ := quotaValues(point, window)
		observed = observed || value != nil || (window == primaryQuota && point.PrimaryObserved) ||
			(window == secondaryQuota && point.SecondaryObserved)
	}
	if !observed {
		return nil
	}
	end := points[len(points)-1]
	remaining, reset := quotaValues(end, window)
	phase := &quotaDecline{StartTs: end.Ts, EndTs: end.Ts, StartRemaining: remaining, Remaining: remaining, ResetAt: reset}
	if remaining == nil {
		return phase
	}
	for index := len(points) - 2; index >= 0; index-- {
		prior := points[index]
		percent, priorReset := quotaValues(prior, window)
		if percent == nil || !equalQuotaValue(priorReset, reset) || *percent+minimumQuotaDrop < *phase.StartRemaining ||
			(priorReset != nil && *priorReset <= phase.StartTs) {
			break
		}
		// Another device (or the other quota window) can report a flat level later.
		// Keep calibration anchored to the actual drop; later costs reduce availability instead.
		if math.Abs(*percent-*remaining) <= minimumQuotaDrop {
			phase.EndTs = prior.Ts
		}
		phase.StartTs, phase.StartRemaining = prior.Ts, percent
	}
	phase.DeclinePercent = max(0, *phase.StartRemaining-*remaining)
	return phase
}

func estimateQuotaDecline(phase quotaDecline, now int64) quotaEstimate {
	estimate := quotaEstimate{ConsumedUSD: phase.ConsumedUSD, DeclinePercent: phase.DeclinePercent,
		StartPercent: phase.StartRemaining, RemainingPercent: phase.Remaining, StartTs: phase.StartTs, EndTs: phase.EndTs}
	if phase.Remaining == nil || (phase.ResetAt != nil && *phase.ResetAt <= now) {
		return estimate
	}
	if phase.DeclinePercent > minimumQuotaDrop && phase.ConsumedUSD > 0 {
		capacity := phase.ConsumedUSD / phase.DeclinePercent * 100
		remaining := max(0, capacity**phase.Remaining/100-phase.AfterUSD)
		if !math.IsInf(capacity, 0) && !math.IsNaN(capacity) {
			estimate.CapacityUSD, estimate.RemainingUSD = &capacity, &remaining
		}
	}
	if *phase.Remaining == 0 {
		zero := 0.0
		estimate.RemainingUSD = &zero
	}
	return estimate
}

func addMinuteToDecline(phase *quotaDecline, minute usageMinute) {
	for _, sample := range minute.Samples {
		ts := minute.Ts + int64(sample[0])
		if ts > phase.StartTs && ts <= phase.EndTs {
			phase.ConsumedUSD += sample[2]
		}
		if ts > phase.EndTs {
			phase.AfterUSD += sample[2]
		}
	}
}
