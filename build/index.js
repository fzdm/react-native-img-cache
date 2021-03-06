import React, { Component } from "react";
import { Image, ImageBackground, Platform } from "react-native";
import RNFetchBlob from "rn-fetch-blob";
const SHA1 = require("crypto-js/sha1");
let BASE_DIR = RNFetchBlob.fs.dirs.CacheDir + "/react-native-img-cache";
const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
const FILE_PREFIX = Platform.OS === "ios" ? "" : "file://";
export class ImageCache {
    constructor() {
        this.cache = {};
    }
    getPath(uri, cachedir, immutable) {
        let path = uri.substring(uri.lastIndexOf("/"));
        path = path.indexOf("?") === -1 ? path : path.substring(path.lastIndexOf("."), path.indexOf("?"));
        let ext = path.indexOf(".") === -1 ? ".jpg" : path.substring(path.indexOf("."));
        if (['.jpg', '.gif', '.jpeg', '.png'].indexOf(ext.toLowerCase()) == -1) { // ensure it's a valid extension 
            ext = '.jpg';
        }
        if (cachedir) {
            BASE_DIR = cachedir;
        }
        if (immutable === true) {
            return BASE_DIR + "/" + SHA1(uri) + ext;
        }
        else {
            return BASE_DIR + "/" + s4() + s4() + "-" + s4() + "-" + s4() + "-" + s4() + "-" + s4() + s4() + s4() + ext;
        }
    }
    static get() {
        if (!ImageCache.instance) {
            ImageCache.instance = new ImageCache();
        }
        return ImageCache.instance;
    }
    clear(cachedir) {
        if (cachedir) {
            BASE_DIR = cachedir;
        }
        this.cache = {};
        return RNFetchBlob.fs.unlink(BASE_DIR);
    }
    on(source, handler, cachedir, immutable) {
        const { uri } = source;
        if (!this.cache[uri]) {
            this.cache[uri] = {
                source,
                downloading: false,
                handlers: [handler],
                immutable: immutable === true,
                path: immutable === true ? this.getPath(uri, cachedir, immutable) : undefined
            };
        }
        else {
            this.cache[uri].handlers.push(handler);
        }
        this.get(uri);
    }
    dispose(uri, handler) {
        const cache = this.cache[uri];
        if (cache) {
            cache.handlers.forEach((h, index) => {
                if (h === handler) {
                    cache.handlers.splice(index, 1);
                }
            });
        }
    }
    bust(uri) {
        const cache = this.cache[uri];
        if (cache !== undefined && !cache.immutable) {
            cache.path = undefined;
            this.get(uri);
        }
    }
    cancel(uri) {
        const cache = this.cache[uri];
        if (cache && cache.downloading) {
            cache.task.cancel();
        }
    }
    preload(source, cachedir, handler, immutable) {
        // Get stats of file (file exists, even if download failed, in case of a succesfull resolved request)
        const handlerWrapper = (path) => {
            if (path) {
                RNFetchBlob.fs.stat(path)
                    .then((stat) => {
                    // Check if downloaded file is larger then 0 bytes
                    if (stat && stat.size > 0) {
                        handler(path);
                    }
                    else { // File downloaded, but without content
                        handler(null);
                    }
                })
                    .catch(() => {
                    handler(null);
                });
            }
            else {
                handler(null);
            }
        };
        this.on(source, handlerWrapper, cachedir, immutable);
    }
    download(cache) {
        const { source } = cache;
        const { uri } = source;
        const { cachedir } = cache;
        if (!cache.downloading) {
            const path = this.getPath(uri, cachedir, cache.immutable);
            cache.downloading = true;
            const method = source.method ? source.method : "GET";
            cache.task = RNFetchBlob.config({ path }).fetch(method, uri, source.headers);
            cache.task.then((res) => {
                const status = res.info().status;
                if (status < 200 || status > 299) {
                    throw new Error("Not caching for status " + status);
                }
                cache.downloading = false;
                cache.path = path;
                this.notify(uri, true);
            }).catch(() => {
                cache.downloading = false;
                // Parts of the image may have been downloaded already, (see https://github.com/wkh237/react-native-fetch-blob/issues/331)
                RNFetchBlob.fs.unlink(path);
            });
        }
    }
    get(uri) {
        const cache = this.cache[uri];
        if (cache.path && cache.downloading == false) {
            // We check here if IOS didn't delete the cache content
            RNFetchBlob.fs.exists(cache.path).then((exists) => {
                if (exists) {
                    this.notify(uri, true);
                }
                else {
                    this.download(cache);
                }
            });
        }
        else {
            this.download(cache);
        }
    }
    notify(uri, success) {
        const handlers = this.cache[uri].handlers;
        handlers.forEach(handler => {
            if (success) {
                handler(this.cache[uri].path);
            }
            else { // Download failed
                handler(null);
            }
        });
    }
}
export class BaseCachedImage extends Component {
    constructor() {
        super(...arguments);
        this.handler = (path) => {
            this.setState({ path });
        };
    }
    dispose() {
        if (this.uri) {
            ImageCache.get().dispose(this.uri, this.handler);
        }
    }
    observe(source, cachedir, mutable) {
        if (source.uri !== this.uri) {
            this.dispose();
            this.uri = source.uri;
            ImageCache.get().on(source, this.handler, cachedir, !mutable);
        }
    }
    getProps() {
        const props = {};
        Object.keys(this.props).forEach(prop => {
            if (prop === "source" && this.props.source.uri) {
                props["source"] = this.state.path ? { uri: FILE_PREFIX + this.state.path } : {};
            }
            else if (["mutable", "component", "cachedir"].indexOf(prop) === -1) {
                props[prop] = this.props[prop];
            }
        });
        return props;
    }
    checkSource(source) {
        if (Array.isArray(source)) {
            throw new Error(`Giving multiple URIs to CachedImage is not yet supported.
            If you want to see this feature supported, please file and issue at
             https://github.com/wcandillon/react-native-img-cache`);
        }
        return source;
    }
    componentWillMount() {
        const { mutable } = this.props;
        const source = this.checkSource(this.props.source);
        const { cachedir } = this.props;
        this.setState({ path: undefined });
        if (typeof (source) !== "number" && source.uri) {
            this.observe(source, cachedir, mutable === true);
        }
    }
    componentWillReceiveProps(nextProps) {
        const { mutable } = nextProps;
        const source = this.checkSource(nextProps.source);
        const { cachedir } = nextProps;
        if (typeof (source) !== "number" && source.uri) {
            this.observe(source, cachedir, mutable === true);
        }
    }
    componentWillUnmount() {
        this.dispose();
    }
}
export class CachedImage extends BaseCachedImage {
    render() {
        const props = this.getProps();
        if (React.Children.count(this.props.children) > 0) {
            console.warn("Using <CachedImage> with children is deprecated, use <CachedImageBackground> instead.");
        }
        return React.createElement(Image, Object.assign({}, props), this.props.children);
    }
}
export class CachedImageBackground extends BaseCachedImage {
    render() {
        const props = this.getProps();
        return React.createElement(ImageBackground, Object.assign({}, props), this.props.children);
    }
}
export class CustomCachedImage extends BaseCachedImage {
    render() {
        const { component } = this.props;
        const props = this.getProps();
        const Component = component;
        return React.createElement(Component, Object.assign({}, props), this.props.children);
    }
}
//# sourceMappingURL=index.js.map