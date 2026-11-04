import { Form, InputNumber, Select, type FormInstance } from "antd";
import { uiText } from "../../../../../../shared/localization/uiText";
import { isFailoverInteger } from "./failoverPolicy";
import styles from "./index.module.less";

const integerRule = (max: number) => ({ validator: (_: unknown, value: unknown) =>
  isFailoverInteger(value, max) ? Promise.resolve()
    : Promise.reject(new Error(uiText("client.aggregateRouting.enterAWholeNumberFrom1To", { max }))) });

export function RoutingSettings({ form }: { form: FormInstance }) {
  const rate = Form.useWatch(["failoverPolicy", "errorRateThresholdPercent"], form);
  return <>
    <Form.Item name={["failoverPolicy", "routingStrategy"]} label={uiText("client.aggregateRouting.serviceSelection")}>
      <Select options={[
        { value: "balanced", label: uiText("client.aggregateRouting.balanceConversations") },
        { value: "priority", label: uiText("client.aggregateRouting.usePriorityOrder") },
      ]} />
    </Form.Item>
    <Form.Item name={["failoverPolicy", "recoverySuccessThreshold"]} label={uiText("client.aggregateRouting.successfulProbesBeforeRecovery")}
      rules={[integerRule(10)]}>
      <InputNumber min={1} max={10} precision={0} style={{ width: "100%" }} />
    </Form.Item>
    <Form.Item name={["failoverPolicy", "errorRateThresholdPercent"]} label={uiText("client.aggregateRouting.pauseAtErrorRate")}
      rules={[{ validator: (_, value: unknown) => value == null || isFailoverInteger(value, 100)
        ? Promise.resolve() : Promise.reject(new Error(uiText("client.aggregateRouting.enterAWholeNumberFrom1To", { max: 100 }))) }]}>
      <InputNumber min={1} max={100} precision={0} placeholder={uiText("client.aggregateRouting.leaveEmptyToDisable")}
        style={{ width: "100%" }} />
    </Form.Item>
    <Form.Item name={["failoverPolicy", "errorRateMinRequests"]} label={uiText("client.aggregateRouting.minimumRequestsForErrorRate")}
      rules={[integerRule(100)]}>
      <InputNumber min={1} max={100} precision={0} disabled={rate == null} style={{ width: "100%" }} />
    </Form.Item>
    <p className={styles.hint}>{uiText("client.aggregateRouting.useTheLast100SuccessfulOrFailedRequestsCanceledRequests")}</p>
  </>;
}
