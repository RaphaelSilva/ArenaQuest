export type HealthData = {
  status: 'ok';
  version: string;
  timestamp: string;
  adapters: Record<string, string>;
};

export function getHealth(adapters: Record<string, string>): HealthData {
  return {
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    adapters,
  };
}
