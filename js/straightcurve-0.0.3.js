var require = function (file, cwd) {
    var resolved = require.resolve(file, cwd || '/');
    var mod = require.modules[resolved];
    if (!mod) throw new Error(
        'Failed to resolve module ' + file + ', tried ' + resolved
    );
    var res = mod._cached ? mod._cached : mod();
    return res;
}

require.paths = [];
require.modules = {};
require.extensions = [".js",".coffee"];

require._core = {
    'assert': true,
    'events': true,
    'fs': true,
    'path': true,
    'vm': true
};

require.resolve = (function () {
    return function (x, cwd) {
        if (!cwd) cwd = '/';
        
        if (require._core[x]) return x;
        var path = require.modules.path();
        var y = cwd || '.';
        
        if (x.match(/^(?:\.\.?\/|\/)/)) {
            var m = loadAsFileSync(path.resolve(y, x))
                || loadAsDirectorySync(path.resolve(y, x));
            if (m) return m;
        }
        
        var n = loadNodeModulesSync(x, y);
        if (n) return n;
        
        throw new Error("Cannot find module '" + x + "'");
        
        function loadAsFileSync (x) {
            if (require.modules[x]) {
                return x;
            }
            
            for (var i = 0; i < require.extensions.length; i++) {
                var ext = require.extensions[i];
                if (require.modules[x + ext]) return x + ext;
            }
        }
        
        function loadAsDirectorySync (x) {
            x = x.replace(/\/+$/, '');
            var pkgfile = x + '/package.json';
            if (require.modules[pkgfile]) {
                var pkg = require.modules[pkgfile]();
                var b = pkg.browserify;
                if (typeof b === 'object' && b.main) {
                    var m = loadAsFileSync(path.resolve(x, b.main));
                    if (m) return m;
                }
                else if (typeof b === 'string') {
                    var m = loadAsFileSync(path.resolve(x, b));
                    if (m) return m;
                }
                else if (pkg.main) {
                    var m = loadAsFileSync(path.resolve(x, pkg.main));
                    if (m) return m;
                }
            }
            
            return loadAsFileSync(x + '/index');
        }
        
        function loadNodeModulesSync (x, start) {
            var dirs = nodeModulesPathsSync(start);
            for (var i = 0; i < dirs.length; i++) {
                var dir = dirs[i];
                var m = loadAsFileSync(dir + '/' + x);
                if (m) return m;
                var n = loadAsDirectorySync(dir + '/' + x);
                if (n) return n;
            }
            
            var m = loadAsFileSync(x);
            if (m) return m;
        }
        
        function nodeModulesPathsSync (start) {
            var parts;
            if (start === '/') parts = [ '' ];
            else parts = path.normalize(start).split('/');
            
            var dirs = [];
            for (var i = parts.length - 1; i >= 0; i--) {
                if (parts[i] === 'node_modules') continue;
                var dir = parts.slice(0, i + 1).join('/') + '/node_modules';
                dirs.push(dir);
            }
            
            return dirs;
        }
    };
})();

require.alias = function (from, to) {
    var path = require.modules.path();
    var res = null;
    try {
        res = require.resolve(from + '/package.json', '/');
    }
    catch (err) {
        res = require.resolve(from, '/');
    }
    var basedir = path.dirname(res);
    
    var keys = (Object.keys || function (obj) {
        var res = [];
        for (var key in obj) res.push(key)
        return res;
    })(require.modules);
    
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.slice(0, basedir.length + 1) === basedir + '/') {
            var f = key.slice(basedir.length);
            require.modules[to + f] = require.modules[basedir + f];
        }
        else if (key === basedir) {
            require.modules[to] = require.modules[basedir];
        }
    }
};

require.define = function (filename, fn) {
    var dirname = require._core[filename]
        ? ''
        : require.modules.path().dirname(filename)
    ;
    
    var require_ = function (file) {
        return require(file, dirname)
    };
    require_.resolve = function (name) {
        return require.resolve(name, dirname);
    };
    require_.modules = require.modules;
    require_.define = require.define;
    var module_ = { exports : {} };
    
    require.modules[filename] = function () {
        require.modules[filename]._cached = module_.exports;
        fn.call(
            module_.exports,
            require_,
            module_,
            module_.exports,
            dirname,
            filename
        );
        require.modules[filename]._cached = module_.exports;
        return module_.exports;
    };
};

if (typeof process === 'undefined') process = {};

if (!process.nextTick) process.nextTick = (function () {
    var queue = [];
    var canPost = typeof window !== 'undefined'
        && window.postMessage && window.addEventListener
    ;
    
    if (canPost) {
        window.addEventListener('message', function (ev) {
            if (ev.source === window && ev.data === 'browserify-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);
    }
    
    return function (fn) {
        if (canPost) {
            queue.push(fn);
            window.postMessage('browserify-tick', '*');
        }
        else setTimeout(fn, 0);
    };
})();

if (!process.title) process.title = 'browser';

if (!process.binding) process.binding = function (name) {
    if (name === 'evals') return require('vm')
    else throw new Error('No such module')
};

if (!process.cwd) process.cwd = function () { return '.' };

require.define("path", function (require, module, exports, __dirname, __filename) {
function filter (xs, fn) {
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (fn(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length; i >= 0; i--) {
    var last = parts[i];
    if (last == '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Regex to split a filename into [*, dir, basename, ext]
// posix version
var splitPathRe = /^(.+\/(?!$)|\/)?((?:.+?)?(\.[^.]*)?)$/;

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
var resolvedPath = '',
    resolvedAbsolute = false;

for (var i = arguments.length; i >= -1 && !resolvedAbsolute; i--) {
  var path = (i >= 0)
      ? arguments[i]
      : process.cwd();

  // Skip empty and invalid entries
  if (typeof path !== 'string' || !path) {
    continue;
  }

  resolvedPath = path + '/' + resolvedPath;
  resolvedAbsolute = path.charAt(0) === '/';
}

// At this point the path should be resolved to a full absolute path, but
// handle relative paths to be safe (might happen when process.cwd() fails)

// Normalize the path
resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
var isAbsolute = path.charAt(0) === '/',
    trailingSlash = path.slice(-1) === '/';

// Normalize the path
path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }
  
  return (isAbsolute ? '/' : '') + path;
};


// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    return p && typeof p === 'string';
  }).join('/'));
};


exports.dirname = function(path) {
  var dir = splitPathRe.exec(path)[1] || '';
  var isWindows = false;
  if (!dir) {
    // No dirname
    return '.';
  } else if (dir.length === 1 ||
      (isWindows && dir.length <= 3 && dir.charAt(1) === ':')) {
    // It is just a slash or a drive letter with a slash
    return dir;
  } else {
    // It is a full dirname, strip trailing slash
    return dir.substring(0, dir.length - 1);
  }
};


exports.basename = function(path, ext) {
  var f = splitPathRe.exec(path)[2] || '';
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPathRe.exec(path)[3] || '';
};

});

require.define("/arc2.js", function (require, module, exports, __dirname, __filename) {
"use strict";


var Vertex2 = require('./vertex2');
var Vector2 = require('./vector2');
var Line2 = require('./line2');


function Arc2(p0, p1, p2) {
    this.p0 = p0;
    this.p1 = p1;
    this.p2 = p2;
};

Arc2.prototype.center = function() {
    var l1 = new Line2(this.p0, this.p1);
    var l2 = new Line2(this.p1, this.p2);

    var lp1 = l1.perp();
    var lp2 = l2.perp();

    return lp1.intersect(lp2);
}

Arc2.prototype.radius = function() {
    var center = this.center();

    return center.distance(this.p0);
}

Arc2.prototype.segmentize = function(segmentCount) {
    var center = this.center();
    var radius = this.radius();

    var p2Side = (this.p1.x - this.p0.x) * (this.p2.y - this.p0.y) - (this.p2.x - this.p0.x) * (this.p1.y - this.p0.y);
    var clockwise = true;
    if (p2Side < 0) {
        clockwise = true;
    } else if (p2Side > 1) {
        clockwise = false;
    } else {
        // help?
        return;
    }

    var a1 = Math.atan2(this.p0.y - center.y, this.p0.x - center.x); // start angle
    var a2 = Math.atan2(this.p1.y - center.y, this.p1.x - center.x);
    var a3 = Math.atan2(this.p2.y - center.y, this.p2.x - center.x); // end angle

    var d = 0;
    if (clockwise) {
        if (a3 > a1) {
            a3 -= 2 * Math.PI;
        }
        if (a2 > a1) {
            a2 -= 2 * Math.PI;
        }
    } else {
        if (a3 < a1) {
            a3 += 2 * Math.PI;
        }
        if (a2 < a1) {
            a2 += 2 * Math.PI;
        }
    }

    var delta = (a3 - a1) / segmentCount;
    var lastPoint;
    var segments = [];
    for (var s = 0; s < segmentCount + 1; ++s) {
        var angle = a1 + delta * s;

        var point = new Vertex2(
            center.x + radius * Math.cos(angle),
            center.y + radius * Math.sin(angle)
        );

        if (lastPoint) {
            var line = new Line2(lastPoint, point);
            segments.push(line);
        }

        lastPoint = point;
    }

    return segments;
}


module.exports = Arc2;

});

require.define("/vertex2.js", function (require, module, exports, __dirname, __filename) {
"use strict";

var Vector2 = require('./vector2');


function Vertex2(x, y) {
    this.x = x;
    this.y = y;
};

Vertex2.prototype.add = function(other) {
    if (!(other instanceof Vector2)) {
        throw new Error('Cannot perform operation');
    }

    return new Vertex2(this.x + other.x, this.y + other.y);
}

Vertex2.prototype.sub = function(other) {
    if (other instanceof Vertex2) {
        return new Vector2(this.x - other.x, this.y - other.y);
    } else if (other instanceof Vector2) {
        return new Vertex2(this.x - other.x, this.y - other.y);
    }

    throw new Error('Cannot perform operation');
};


module.exports = Vertex2;

});

require.define("/vector2.js", function (require, module, exports, __dirname, __filename) {
"use strict";

function Vector2(x, y) {
    this.x = x;
    this.y = y;
};

Vector2.prototype.normalized = function() {
    var v = new Vector2(this.x, this.y);
    v.normalize();
    return v;
}

Vector2.prototype.normalize = function() {
    var length = this.length();

    this.x /= length;
    this.y /= length;
}

Vector2.prototype.dot = function(vector) {
    return this.x * vector.x + this.y * vector.y;
}

Vector2.prototype.cross = function(vector) {
    return this.x * vector.y - this.y * vector.x;
}

Vector2.prototype.angle = function(vector) {
    // The angle between to vectors can be calculated with the formula:
    // a.b = |a||b|cos θ
    //
    // Rewriting gives:
    //  a.b  = cos θ
    // ------
    // |a||b|
    var theta = this.dot(vector) / (this.length() * vector.length()); // number
    return Math.acos(theta);
}

Vector2.prototype.signedAngle = function(vector) {
    // atan2(perp_dot(v1,v2),dot(v1,v2));
    return Math.atan2(this.perp().dot(vector), this.dot(vector));
}

Vector2.prototype.length = function(l) {
    if (typeof l === 'undefined') {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    this.normalize();
    this.x *= length;
    this.y *= length;
}

Vector2.prototype.perp = function() {
    return new Vector2(-this.y, this.x);
}

Vector2.prototype.add = function(other) {
    return new Vector2(this.x + other.x, this.y + other.y);
}

Vector2.prototype.sub = function(other) {
    return new Vector2(this.x - other.x, this.y - other.y);
}

Vector2.prototype.mult = function(value) {
    return new Vector2(this.x * value, this.y * value);
}

Vector2.prototype.div = function(value) {
    return new Vector2(this.x / value, this.y / value);
}


module.exports = Vector2;

});

require.define("/line2.js", function (require, module, exports, __dirname, __filename) {
"use strict";


var Vertex2 = require('./vertex2');
var Vector2 = require('./vector2');
var Circle2 = require('./circle2');


function Line2(p0, p1) {
    this.p0 = p0;
    this.p1 = p1;
};

Line2.prototype.slope = function() {
    return (this.p1.y - this.p0.y) / (this.p1.x - this.p0.x);
}

Line2.prototype.toAbc = function() {
    var a = this.p1.y - this.p0.y;
    var b = this.p0.x - this.p1.x;
    var c = a * this.p0.x + b * this.p0.y;

    return {
        a: a,
        b: b,
        c: c
    };
}

Line2.prototype.intersect = function(other) {
    var i1 = this.toAbc();
    var i2 = other.toAbc();

    var denominator = i1.a * i2.b - i2.a * i1.b;
    if (denominator != 0) {
        return new Vertex2 ((i2.b * i1.c - i1.b * i2.c) / denominator, (i1.a * i2.c - i2.a * i1.c) / denominator);
    }

    return null;
}

Line2.prototype.angle = function(other) {
    var a = this.getDirection(); // Vector2
    var b = other.getDirection(); // Vector2

    return a.angle(b);
}

Line2.prototype.signedAngle = function(other) {
    var a = this.getDirection(); // Vector2
    var b = other.getDirection(); // Vector2

    return a.signedAngle(b);
}

Line2.prototype.getDirection = function() {
    var d = this.p1.sub(this.p0); // Vector2
    return d.normalized();
}

Line2.prototype.perp = function(point) {
    var p0;
    if (point) {
        p0 = point;
    } else {
        // take: p0 + (p1 - p0) / 2
        var half = this.p1.sub(this.p0).div(2); // Vector2
        p0 = this.p0.add(half);
    }

    if (this.distance(p0) != 0) {
        throw new Error('point not on line');
    }

    var v = this.getDirection(); // Vector2
    v = v.perp();
    var p1 = p0.add(v);

    return new Line2(p0, p1);
}


module.exports = Line2;

});

require.define("/circle2.js", function (require, module, exports, __dirname, __filename) {
"use strict";


function Circle2(center, radius) {
    this.center = center;
    this.radius = radius;
};


module.exports = Circle2;

});

require.define("/distancer.js", function (require, module, exports, __dirname, __filename) {
"use strict";


var Vertex2 = require('./vertex2');
var Line2 = require('./line2');
var Circle2 = require('./circle2');


function Distancer() {
}

Distancer.distance = function(other) {
    for (var i = 0; i < Distancer.table.length; ++i) {
        var e = Distancer.table[i];
        if (this instanceof e[0] && other instanceof e[1]) {
            return e[2](this, other);
        } else if (this instanceof e[1] && other instanceof e[0]) {
            return e[2](other, this);
        }
    }
}

Distancer.Vertex2Vertex2 = function(p1, p2) {
    var v = p1.sub(p2); // Vertex2
    return v.length();
}

Distancer.Vertex2Line2 = function(p1, l1) {
    var v = l1.p1.sub(l1.p0); // Vector2
    var w = p1.sub(l1.p0); // Vector2

    var c1 = w.dot(v); // number
    var c2 = v.dot(v); // number
    var b = c1 / c2; // number

    var a = v.mult(b); // Vector2
    var p = l1.p0.add(a); // Vertex2
    var d = p1.sub(p); // Vector2
    return d.length(); // number
}

Distancer.Vertex2Circle2 = function(p1, c1) {
    var distanceToCenter = p1.distance(c1.center);
    if (distanceToCenter <= c1.radius) {
        return 0.0;
    }

    return distanceToCenter - c1.radius;
}

Distancer.Line2Line2 = function (l1, l2) {
    // XXX: TODO
}

Distancer.Line2Circle2 = function(l1, c1) {
    var distanceToCenter = l1.distance(c1.center);
    if (distanceToCenter < c1.radius) {
        return 0.0;
    }

    return distanceToCenter - c1.radius;
}

Distancer.Circle2Circle2 = function(c1, c2) {
    var distanceToCenter = c1.center.distance(c2.center);
    if (distanceToCenter <= (c1.radius + c2.radius)) {
        return 0.0;
    }

    return distanceToCenter - c1.radius - c2.radius;
}

Distancer.table = [
    [ Vertex2, Vertex2, Distancer.Vertex2Vertex2 ],
    [ Vertex2, Line2,   Distancer.Vertex2Line2   ],
    [ Vertex2, Circle2, Distancer.Vertex2Circle2 ],
    [ Line2,   Line2,   Distancer.Line2Line2     ],
    [ Line2,   Circle2, Distancer.Line2Circle2   ],
    [ Circle2, Circle2, Distancer.Circle2Circle2 ],
];


Vertex2.prototype.distance = Distancer.distance;
Line2.prototype.distance = Distancer.distance;
Circle2.prototype.distance = Distancer.distance;


module.exports = Distancer;

});

require.define("/browserify.js", function (require, module, exports, __dirname, __filename) {
    var straightcurve = {
    Arc2: require('./arc2'),
    Circle2: require('./circle2'),
    Line2: require('./line2'),
    Vector2: require('./vector2'),
    Vertex2: require('./vertex2'),
};

require('./distancer');

// assume this script is run in a function with context as first argument
window.straightcurve = straightcurve;

});
require("/browserify.js");

