import { AxiosError, AxiosInstance } from "axios";
import { DevnetProviderError } from "./types";
import { parseJsonPreservingIntegers } from "./json";

export class RpcProvider {
    public constructor(
        private httpProvider: AxiosInstance,
        private url: string,
    ) {}

    /**
     * @param options.preserveLargeIntegers if `true`, integers in the response that do not fit in a
     *      JS number are not rounded, but kept so that `JSON.stringify` reproduces them exactly
     */
    public async sendRequest(
        method: string,
        params: unknown = {},
        options: { preserveLargeIntegers?: boolean } = {},
        // oxlint-disable-next-line typescript/no-explicit-any
    ): Promise<any> {
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
                ...(options.preserveLargeIntegers && {
                    transformResponse: (data: string) => parseJsonPreservingIntegers(data),
                }),
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
