// Pages builds must work with every outbound Node transport disabled.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
const denied = () => { throw Error("CI_BUILD_NETWORK_FORBIDDEN"); };
globalThis.fetch = denied;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = tls.connect = denied;
syncBuiltinESMExports();
