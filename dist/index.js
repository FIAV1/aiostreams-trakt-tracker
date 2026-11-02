function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_with_holes(arr) {
    if (Array.isArray(arr)) return arr;
}
function _array_without_holes(arr) {
    if (Array.isArray(arr)) return _array_like_to_array(arr);
}
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
        var info = gen[key](arg);
        var value = info.value;
    } catch (error) {
        reject(error);
        return;
    }
    if (info.done) resolve(value);
    else Promise.resolve(value).then(_next, _throw);
}
function _async_to_generator(fn) {
    return function() {
        var self = this, args = arguments;
        return new Promise(function(resolve, reject) {
            var gen = fn.apply(self, args);
            function _next(value) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(undefined);
        });
    };
}
function _iterable_to_array(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) {
        return Array.from(iter);
    }
}
function _iterable_to_array_limit(arr, i) {
    var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
    if (_i == null) return;
    var _arr = [];
    var _n = true;
    var _d = false;
    var _s, _e;
    try {
        for(_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true){
            _arr.push(_s.value);
            if (i && _arr.length === i) break;
        }
    } catch (err) {
        _d = true;
        _e = err;
    } finally{
        try {
            if (!_n && _i["return"] != null) _i["return"]();
        } finally{
            if (_d) throw _e;
        }
    }
    return _arr;
}
function _non_iterable_rest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _non_iterable_spread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _sliced_to_array(arr, i) {
    return _array_with_holes(arr) || _iterable_to_array_limit(arr, i) || _unsupported_iterable_to_array(arr, i) || _non_iterable_rest();
}
function _to_consumable_array(arr) {
    return _array_without_holes(arr) || _iterable_to_array(arr) || _unsupported_iterable_to_array(arr) || _non_iterable_spread();
}
function _ts_generator(thisArg, body) {
    var f, y, t, _ = {
        label: 0,
        sent: function() {
            if (t[0] & 1) throw t[1];
            return t[1];
        },
        trys: [],
        ops: []
    }, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype), d = Object.defineProperty;
    return d(g, "next", {
        value: verb(0)
    }), d(g, "throw", {
        value: verb(1)
    }), d(g, "return", {
        value: verb(2)
    }), typeof Symbol === "function" && d(g, Symbol.iterator, {
        value: function() {
            return this;
        }
    }), g;
    function verb(n) {
        return function(v) {
            return step([
                n,
                v
            ]);
        };
    }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while(g && (g = 0, op[0] && (_ = 0)), _)try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [
                op[0] & 2,
                t.value
            ];
            switch(op[0]){
                case 0:
                case 1:
                    t = op;
                    break;
                case 4:
                    _.label++;
                    return {
                        value: op[1],
                        done: false
                    };
                case 5:
                    _.label++;
                    y = op[1];
                    op = [
                        0
                    ];
                    continue;
                case 7:
                    op = _.ops.pop();
                    _.trys.pop();
                    continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                        _ = 0;
                        continue;
                    }
                    if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                        _.label = op[1];
                        break;
                    }
                    if (op[0] === 6 && _.label < t[1]) {
                        _.label = t[1];
                        t = op;
                        break;
                    }
                    if (t && _.label < t[2]) {
                        _.label = t[2];
                        _.ops.push(op);
                        break;
                    }
                    if (t[2]) _.ops.pop();
                    _.trys.pop();
                    continue;
            }
            op = body.call(thisArg, _);
        } catch (e) {
            op = [
                6,
                e
            ];
            y = 0;
        } finally{
            f = t = 0;
        }
        if (op[0] & 5) throw op[1];
        return {
            value: op[0] ? op[1] : void 0,
            done: true
        };
    }
}
function _unsupported_iterable_to_array(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _array_like_to_array(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(o);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _array_like_to_array(o, minLen);
}
import { configureLogging, createLogger, defineAddon, defineEnv } from '@aiostreams/addon-sdk';
import { serve } from '@aiostreams/addon-sdk/node';
import { z } from 'zod';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
var env = defineEnv({
    PORT: z.coerce.number().int().default(7000).describe('Port to listen on'),
    DATA_FILE: z.string().default('data/trakt-tracker.json').describe('File to store data in'),
    LOG_LEVEL: z.enum([
        'debug',
        'info',
        'warn',
        'error'
    ]).default('info').describe('Log level')
});
configureLogging({
    level: env.LOG_LEVEL
});
var log = createLogger('trakt-tracker');
var emptyHistory = function emptyHistory() {
    return {
        inProgress: {},
        movies: [],
        episodes: [],
        watchlist: {},
        ratings: {},
        changed: Date.now()
    };
};
var store = await readFile(env.DATA_FILE, 'utf8').then(function(text) {
    return JSON.parse(text);
}).catch(function(err) {
    if (err.code !== 'ENOENT') throw err;
    log.info({
        file: env.DATA_FILE
    }, 'starting with no history');
    return {};
});
function updateStore(viewer, change) {
    return _async_to_generator(function() {
        var _store, _ref, _, history;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    history = (_ = (_store = store)[_ref = viewer !== null && viewer !== void 0 ? viewer : '']) !== null && _ !== void 0 ? _ : _store[_ref] = emptyHistory();
                    change(history);
                    history.changed = Date.now();
                    return [
                        4,
                        mkdir(dirname(env.DATA_FILE), {
                            recursive: true
                        })
                    ];
                case 1:
                    _state.sent();
                    return [
                        4,
                        writeFile(env.DATA_FILE, JSON.stringify(store, null, 2))
                    ];
                case 2:
                    _state.sent();
                    return [
                        2
                    ];
            }
        });
    })();
}
var toggle = function toggle(list, id, on) {
    return on ? _to_consumable_array(new Set(_to_consumable_array(list).concat([
        id
    ]))) : list.filter(function(item) {
        return item !== id;
    });
};
function applyEvent(history, event) {
    var now = event.at;
    switch(event.event){
        case 'start':
        case 'pause':
        case 'stop':
            {
                var played = event.event === 'stop' && event.played;
                if (played || event.positionMs === 0) {
                    delete history.inProgress[event.videoId];
                } else {
                    history.inProgress[event.videoId] = {
                        type: event.scope === 'movie' ? 'movie' : 'series',
                        metaId: event.metaId,
                        videoId: event.videoId,
                        season: event.season,
                        episode: event.episode,
                        positionMs: event.positionMs,
                        durationMs: event.durationMs,
                        at: now
                    };
                }
                if (played) {
                    markWatched(history, event.scope, [
                        event.videoId
                    ], true);
                }
                break;
            }
        case 'played':
        case 'unplayed':
            {
                var on = event.event === 'played';
                if ('videos' in event) {
                    markWatched(history, 'episode', event.videos.map(function(v) {
                        return v.videoId;
                    }), on);
                } else {
                    markWatched(history, event.scope, [
                        event.videoId
                    ], on);
                }
                break;
            }
        case 'watchlisted':
            history.watchlist[event.metaId] = {
                type: event.scope === 'movie' ? 'movie' : 'series',
                at: now
            };
            break;
        case 'unwatchlisted':
            delete history.watchlist[event.metaId];
            break;
        case 'rated':
            if (event.rating !== undefined) {
                var _event_videoId;
                var key = (_event_videoId = event.videoId) !== null && _event_videoId !== void 0 ? _event_videoId : event.season !== undefined && event.season !== null ? "".concat(event.metaId, ":s").concat(event.season) : event.metaId;
                history.ratings[key] = event.rating;
            }
            break;
        case 'unrated':
            {
                var _event_videoId1;
                var key1 = (_event_videoId1 = event.videoId) !== null && _event_videoId1 !== void 0 ? _event_videoId1 : event.season !== undefined && event.season !== null ? "".concat(event.metaId, ":s").concat(event.season) : event.metaId;
                delete history.ratings[key1];
                break;
            }
    }
}
function markWatched(history, scope, ids, on) {
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = ids[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var id = _step.value;
            if (scope === 'movie') {
                history.movies = toggle(history.movies, id, on);
            } else {
                history.episodes = toggle(history.episodes, id, on);
            }
            if (on) {
                delete history.inProgress[id];
            }
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally{
        try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
            }
        } finally{
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }
}
var addon = defineAddon({
    manifest: {
        id: 'com.aiostreams.trakttracker',
        version: '1.0.0',
        name: 'Trakt Watch State Tracker',
        description: 'Tracks watch state, history, watchlists and ratings for AIOStreams via Trakt protocol.',
        types: [
            'movie',
            'series'
        ],
        resources: [
            {
                name: 'watch_state',
                types: [
                    'movie',
                    'series'
                ]
            },
            'player',
            'library'
        ],
        watchState: {
            version: 2,
            viewers: true,
            push: {
                events: [
                    'start',
                    'pause',
                    'stop',
                    'played',
                    'unplayed',
                    'watchlisted',
                    'unwatchlisted',
                    'dropped',
                    'undropped',
                    'rated',
                    'unrated'
                ],
                bulk: true
            },
            pull: {
                items: true,
                watched: true,
                watchlist: true,
                ratings: true,
                ttlSeconds: 300
            }
        },
        behaviorHints: {
            configurable: false
        }
    },
    watchState: {
        push: function push(param) {
            var event = param.event, viewer = param.viewer;
            return _async_to_generator(function() {
                return _ts_generator(this, function(_state) {
                    switch(_state.label){
                        case 0:
                            log.info({
                                event: event.event,
                                viewer: viewer,
                                metaId: event.metaId
                            }, 'received watch state push event');
                            return [
                                4,
                                updateStore(viewer, function(history) {
                                    return applyEvent(history, event);
                                })
                            ];
                        case 1:
                            _state.sent();
                            return [
                                2
                            ];
                    }
                });
            })();
        },
        pull: function pull(param) {
            var viewer = param.viewer;
            return _async_to_generator(function() {
                var _store_, history;
                return _ts_generator(this, function(_state) {
                    log.info({
                        viewer: viewer
                    }, 'received watch state pull request');
                    history = (_store_ = store[viewer !== null && viewer !== void 0 ? viewer : '']) !== null && _store_ !== void 0 ? _store_ : emptyHistory();
                    return [
                        2,
                        {
                            version: String(history.changed),
                            items: Object.values(history.inProgress),
                            watched: function watched() {
                                return {
                                    movies: history.movies,
                                    episodes: history.episodes
                                };
                            },
                            watchlist: Object.entries(history.watchlist).map(function(param) {
                                var _param = _sliced_to_array(param, 2), metaId = _param[0], entry = _param[1];
                                return {
                                    type: entry.type,
                                    metaId: metaId,
                                    at: entry.at
                                };
                            }),
                            ratings: Object.entries(history.ratings).map(function(param) {
                                var _param = _sliced_to_array(param, 2), key = _param[0], rating = _param[1];
                                // If key has a videoId or season, parse it appropriately according to protocol
                                if (key.includes(':s')) {
                                    var _key_split = _sliced_to_array(key.split(':s'), 2), metaId = _key_split[0], sPart = _key_split[1];
                                    return {
                                        type: 'series',
                                        metaId: metaId,
                                        season: Number(sPart),
                                        rating: rating,
                                        at: Date.now()
                                    };
                                } else if (key.includes(':')) {
                                    return {
                                        type: 'series',
                                        metaId: key.split(':')[0],
                                        videoId: key,
                                        rating: rating,
                                        at: Date.now()
                                    };
                                } else {
                                    // movie or series show level rating
                                    return {
                                        type: 'series',
                                        metaId: key,
                                        rating: rating,
                                        at: Date.now()
                                    };
                                }
                            })
                        }
                    ];
                });
            })();
        }
    },
    player: function player(param) {
        var type = param.type, id = param.id, action = param.action, currentTime = param.currentTime, duration = param.duration;
        return _async_to_generator(function() {
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        log.info({
                            type: type,
                            id: id,
                            action: action,
                            currentTime: currentTime,
                            duration: duration
                        }, 'received player event');
                        return [
                            4,
                            updateStore(undefined, function(history) {
                                var finished = action === 'stop' && duration !== undefined && currentTime >= duration * 0.9;
                                if (finished) {
                                    markWatched(history, type === 'movie' ? 'movie' : 'episode', [
                                        id
                                    ], true);
                                } else if (action === 'stop' || currentTime === 0) {
                                    delete history.inProgress[id];
                                } else {
                                    history.inProgress[id] = {
                                        type: type,
                                        metaId: id.split(':')[0],
                                        videoId: id,
                                        positionMs: currentTime,
                                        durationMs: duration,
                                        at: Math.floor(Date.now() / 1000)
                                    };
                                }
                            })
                        ];
                    case 1:
                        _state.sent();
                        return [
                            2
                        ];
                }
            });
        })();
    },
    library: function library(param) {
        var type = param.type, id = param.id, action = param.action, videoIds = param.videoIds;
        return _async_to_generator(function() {
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        log.info({
                            type: type,
                            id: id,
                            action: action,
                            videoIds: videoIds
                        }, 'received library event');
                        return [
                            4,
                            updateStore(undefined, function(history) {
                                if (action === 'libraryAdd') {
                                    history.watchlist[id] = {
                                        type: type === 'channel' ? 'series' : type,
                                        at: Math.floor(Date.now() / 1000)
                                    };
                                } else if (action === 'libraryRemove') {
                                    delete history.watchlist[id];
                                } else {
                                    markWatched(history, type === 'movie' ? 'movie' : 'episode', videoIds.length ? videoIds : [
                                        id
                                    ], action === 'watched');
                                }
                            })
                        ];
                    case 1:
                        _state.sent();
                        return [
                            2
                        ];
                }
            });
        })();
    }
});
await serve(addon, {
    port: env.PORT
});

