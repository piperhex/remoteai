import { createAction, createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { consumeAccountsQuota, type QuotaProgress } from './quotaConsumption';

interface QuotaState { requestId: string | null; progress: QuotaProgress }
const initialState: QuotaState = { requestId: null, progress: { done: 0, total: 0 } };
const progressChanged = createAction<QuotaProgress & { requestId: string }>('quota/progress');

export const consumeAllQuota = createAsyncThunk('quota/consumeAll', async (ids: string[], task) =>
  consumeAccountsQuota(ids, progress => task.dispatch(progressChanged({ ...progress, requestId: task.requestId }))), {
  condition: (_, { getState }) => {
    const state = getState() as { quotaConsumption: QuotaState; data: { refreshing: boolean } };
    return !state.quotaConsumption.requestId && !state.data.refreshing;
  },
});

const slice = createSlice({
  name: 'quotaConsumption', initialState, reducers: {},
  extraReducers: builder => builder
    .addCase(consumeAllQuota.pending, (state, action) => {
      state.requestId = action.meta.requestId;
      state.progress = { done: 0, total: new Set(action.meta.arg).size };
    })
    .addCase(progressChanged, (state, action) => {
      if (state.requestId === action.payload.requestId) state.progress = action.payload;
    })
    .addCase(consumeAllQuota.fulfilled, (state, action) => {
      if (state.requestId === action.meta.requestId) state.requestId = null;
    })
    .addCase(consumeAllQuota.rejected, (state, action) => {
      if (state.requestId === action.meta.requestId) state.requestId = null;
    }),
});

export default slice.reducer;
