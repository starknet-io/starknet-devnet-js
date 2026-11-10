import { AxiosError, AxiosInstance } from "axios";
import { DevnetProviderError } from "./types";

export class RpcProvider {
    public constructor(
        private httpProvider: AxiosInstance,
        private url: string,
    ) {}

    // oxlint-disable-next-line typescript/no-explicit-any
    public async sendRequest(method: string, params: unknown = {}): Promise<any> {
        // providing a string may be of use in case a bigint needs to be preserved
        const paramsSerialized = typeof params === "string" ? params : JSON.stringify(params);

        const jsonRpcBodySerialized = `{
            "jsonrpc": "2.0",
            "id": "1",
            "method": "${method}",
            "params": ${paramsSerialized}
        }`;

        return this.httpProvider
            .post(this.url, jsonRpcBodySerialized, {
                headers: {
                    "Content-Type": "application/json",
                },
            })
            .then((resp) => {
                if ("result" in resp.data) {
                    return resp.data["result"];
                } else if ("error" in resp.data) {
                    // not wrapping in new Error to avoid printing as [Object object]
                    throw resp.data["error"];
                } else {
                    throw resp.data;
                }
            })
            .catch((err) => {
                if (err.code === AxiosError.ECONNABORTED) {
                    throw DevnetProviderError.fromAxiosError(err);
                }
                throw err;
            });
    }
}
