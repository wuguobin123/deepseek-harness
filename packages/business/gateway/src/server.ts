import { createServer } from 'node:http'
import { BusinessGateway } from './index.ts'

const configPath = process.env.DSH_BUSINESS_GATEWAY_CONFIG
const port = Number(process.env.DSH_BUSINESS_GATEWAY_PORT)
if (configPath === undefined) throw new Error('DSH_BUSINESS_GATEWAY_CONFIG is required')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DSH_BUSINESS_GATEWAY_PORT must be 1..65535')
const databaseRoot = process.env.DSH_GATEWAY_DATABASE_ROOT ?? process.env.DSH_XIAOWEI_HOME
if (databaseRoot === undefined) throw new Error('DSH_GATEWAY_DATABASE_ROOT is required')
const gateway = new BusinessGateway({ configPath, databaseRoot, databasePath: `${databaseRoot}/identity.sqlite`, auditPath: process.env.DSH_BUSINESS_GATEWAY_AUDIT ?? `${databaseRoot}/business-gateway.audit.jsonl`, env: process.env })
const server = createServer((req, res) => { gateway.handle(req, res) })
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ listening: true, address: server.address() }) + '\n')
})
const shutdown = (): void => { gateway.close(); server.close(() => process.exit(0)) }
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
