import axios from "axios";
import _ from "lodash";
import humps from "humps";
import {config} from "../config";
import {store} from "../store";
import {toastNotificationAction, authAction} from "../actions";
import {authApi} from "../api";

export const clientUtil = {
    setErrorHandler,
    setDefaultInterceptors
    //   initialSessionAfterSignIn,
    //   renewSession,
    //   isTimeoutError
};

// for multiple requests
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, accessToken = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(accessToken);
        }
    });

    failedQueue = [];
};

function setDefaultInterceptors(instance = axios) {
    instance.interceptors.request.use(
        requestConfig => {
            const customRequestConfig = {...requestConfig};

            // decamelize params to each request paramsOne => params_one
            if (_.has(customRequestConfig, "params")) {
                customRequestConfig.params = humps.decamelizeKeys(
                    customRequestConfig.params
                );
            }

            // decamelize data to each request paramsOne => params_one
            if (customRequestConfig.headers["Content-Type"] !== "multipart/form-data")
                if (_.has(customRequestConfig, "data")) {
                    customRequestConfig.data = humps.decamelizeKeys(
                        customRequestConfig.data
                    );
                }

            // camelize params to each response params_one => paramsOne
            customRequestConfig.transformResponse = [
                ...instance.defaults.transformResponse,
                data => humps.camelizeKeys(data)
            ];

            // set default header
            customRequestConfig.headers = {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + store.getState().auth.accessToken,
                ...customRequestConfig.headers
            };

            if (config.REQUEST_LOG_ENABLED) {
                console.log(
                    "Request to [Start]:",
                    customRequestConfig.url,
                    "\n",
                    "Method: ",
                    customRequestConfig.method,
                    "\n",
                    "Params: ",
                    customRequestConfig.params,
                    "\n",
                    "Data: ",
                    customRequestConfig.data,
                    "\n",
                    "Headers: ",
                    customRequestConfig.headers
                );
            }

            return customRequestConfig;
        },
        requestError => {
            const {requestConfig} = requestError;

            if (config.REQUEST_LOG_ENABLED) {
                console.log("Request to [Failed]:", requestConfig.url);
            }

            return Promise.reject(requestError);
        }
    );

    instance.interceptors.response.use(
        response => {
            if (config.RESPONSE_LOG_ENABLED) {
                console.log(`Response from [${response.config.url}]:`, response);
            }
            return response;
        },
        error => {
            const originalRequest = error.config;
            if (error.response.status === 401 && !originalRequest._retry && originalRequest.url !== "http://xxx.xxx-xxx.com:8080/oauth/token") {

                if (isRefreshing) {
                    return new Promise((resolve, reject) => {
                        failedQueue.push({resolve, reject})
                    }).then(accessToken => {
                        originalRequest.headers['Authorization'] = 'Bearer ' + accessToken;
                        return axios(originalRequest);
                    }).catch(err => {
                        // When refresh token expire
                        return Promise.reject(err)
                    })
                }

                originalRequest._retry = true;
                isRefreshing = true;

                const refreshToken = store.getState().auth.refreshToken;
                const {signInSuccess, signOutSuccess} = authAction;

                return new Promise(function (resolve, reject) {
                    // When access token expire
                    authApi.getRefreshToken(refreshToken)
                        .then(({data}) => {
                            store.dispatch(signInSuccess(data));

                            // axios.defaults.headers.common['Authorization'] = 'Bearer ' + data.accessToken;
                            processQueue(null, data.accessToken);

                            originalRequest.headers['Authorization'] = 'Bearer ' + data.accessToken;
                            resolve(axios(originalRequest));
                        })
                        .catch((err) => {
                            processQueue(err, null);
                            // When refresh token expire
                            store.dispatch(signOutSuccess());
                            reject(err);
                        })
                        .then(() => {
                            isRefreshing = false
                        })
                })
            }

            return Promise.reject(error);
        }
    );
    console.log("Set default interceptors for Axios");
}

function setErrorHandler(instance = axios) {
    instance.interceptors.response.use(
        response => response,
        error => errorHandler(error)
    );
    console.log("Set default error handler for Axios");
}

function errorHandler(error) {
    const {showToastNotification} = toastNotificationAction;
    const customError = error;
    const timeoutMessage = `Timeout of ${config.NETWORK_TIMEOUT}ms.`;

    const notificationDetail = {
        title: "Client error responses",
        message: "custom",
        color: "danger",
        position: "top-right"
    };

    if (_.get(error, "message") === timeoutMessage) {
        if (config.RESPONSE_TOAST_ENABLED) {
            notificationDetail.message = `Timeout of ${config.NETWORK_TIMEOUT}ms.`;
            store.dispatch(showToastNotification(notificationDetail));
        }
        return Promise.reject(new Error(timeoutMessage));
    }
    if (customError.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        const {
            status: httpCode
            // config: { url }
        } = customError.response;

        // TODO: Set Error Message / Refactor
        if (httpCode === 400) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "400 Bad Request.";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 401) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "401 Unauthorized.";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 403) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "403 Forbidden.";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 404) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "404 Not Found.";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 405) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "405 Method Not Allowed.";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 408) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "408 Request Timeout.";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 429) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "429 Too Many Requests.";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 500) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.title = "Server error responses.";
                notificationDetail.message = "500 Internal Server Error";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else if (httpCode === 502) {
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.title = "Server error responses.";
                notificationDetail.message = "502 Bad Gateway";
                store.dispatch(showToastNotification(notificationDetail));
            }
            return Promise.reject(customError);
        } else {
            //   "responseError"
            if (config.RESPONSE_TOAST_ENABLED) {
                notificationDetail.message = "The response from the server is incorrect.";
                store.dispatch(showToastNotification(notificationDetail));
            }
        }
    } else if (customError.request) {
        // "Request Error"
        if (config.RESPONSE_TOAST_ENABLED) {
            notificationDetail.message = "No response from the server.";
            store.dispatch(showToastNotification(notificationDetail));
        }
    } else {
        // "otherError"
        if (config.RESPONSE_TOAST_ENABLED) {
            notificationDetail.message = "Cannot request information.";
            store.dispatch(showToastNotification(notificationDetail));
        }
    }

    return Promise.reject(customError);
}