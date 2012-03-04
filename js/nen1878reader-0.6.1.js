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

require.define("/geojson.js", function (require, module, exports, __dirname, __filename) {
"use strict";

function extractPoint(record) {
    var coordinates = record.geometry.coordinates;

    return {
        type: 'Point',
        coordinates: [
            coordinates[0].x, coordinates[0].y
        ]
    };
}

function extractLineString(record) {
    var coordinates = record.geometry.coordinates;

    var c = [];
    coordinates.forEach(function(coordinate) {
        c.push([
                coordinate.x, coordinate.y
        ]);
    });

    return {
        type: 'LineString',
        coordinates: c
    };
}

function toFeature(record) {
    var feature = {
        type: 'Feature',
        properties: { }
    };

    // properties
    for (var key in record) {
        if (key === 'geometry' || key === 'geometryType') {
            continue;
        }

        feature.properties[key] = record[key];
    }

    // geometry
    if (record.recordType == 3) {
        if (record.geometryType == 1) {
            feature.geometry = extractPoint(record);
        } else if (record.geometryType == 12) {
            feature.geometry = extractLineString(record);
        } else if (record.geometryType == 13) {
            feature.geometry = null;
        }
    } else if (record.recordType == 5) {
        if (record.textOrSymbol== 1) {
            feature.geometry = extractPoint(record);
        } else if (record.textOrSymbol == 2) {
            feature.geometry = extractPoint(record);
        }
    }

    return feature;
}

module.exports.extractPoint = extractPoint;
module.exports.extractLineString = extractLineString;
module.exports.toFeature = toFeature;

});

require.define("/nen1878_parser.js", function (require, module, exports, __dirname, __filename) {
"use strict";

var events = require('events');
var util = require('util');


util.inherits(Nen1878Parser, events.EventEmitter);


var coordinate = {};
function Nen1878Parser() {
    this.record = {};
    coordinate = {};
}


Nen1878Parser.prototype.parseLine = function(line) {
    var recordType = line.slice(0, 2);
    var isLastRecord = line.slice(62, 64) == '01';

    var parserFunction = parser[recordType];
    if (parserFunction) {
        parserFunction.apply(this.record, [ line ]);
    } else {
        this.emit('error', 'Unknown record type: ' + recordType);
    }

    if (isLastRecord || recordType == '99') { // record type 99 does not have a record-ender-mark
        this.emit('record', this.record);
        this.record = {};
    }
}


var parser = {
    '01': function(line) {
        this.recordType = parseInt(line.slice(0, 2));
        this.name = line.slice(3, 14); // A (04-14) : (afgekorte) bestandsnaam (vrij invulbaar)
        this.type = line.slice(14, 15); // V: volledig betand, G: mutatie bestand
        this.date = new Date(line.slice(21, 25), line.slice(25, 27) - 1); // actualiteitsdatum van het bestand
        this.totalFiles = parseInt(line.slice(34, 36)); // aantal deelbestanden van de uitwisseling
        this.currentFile = parseInt(line.slice(36, 38)); // huidig deelbestandsnummer
        this.productCode = line.slice(38, 41); // productcode voor GBKN
    },
    '02': function(line) {
        this.recordType = parseInt(line.slice(0, 2));
    },
    '03': function(line) {
        this.recordType = parseInt(line.slice(0, 2));

        for (var i = 2; i < 62; i += 10) {
            var subLine = line.slice(i, i + 10);
            var subRecordType = subLine.slice(0, 1);
            if (parser03[subRecordType]) {
                parser03[subRecordType].apply(this, [ subLine ]);
            }
        }
    },
    '04': function(line) {
        this.geometry = this.geometry || {};
        this.geometry.coordinates = this.geometry.coordinates || [];

        for (var i = 2; i < 62; i += 10) {
            var subLine = line.slice(i, i + 10);
            var subRecordType = subLine.slice(0, 1);
            if (parser04[subRecordType]) {
                parser04[subRecordType].apply(this, [ subLine ]);
            }
        }
    },
    '05': function(line) {
        this.recordType = this.recordType || parseInt(line.slice(0, 2));

        this.geometry = this.geometry || {};
        this.geometry.coordinates = this.geometry.coordinates || [];

        for (var i = 2; i < 62; i += 10) {
            var subLine = line.slice(i, i + 10);
            var subRecordType = subLine.slice(0, 1);
            if (parser05[subRecordType]) {
                parser05[subRecordType].apply(this, [ subLine ]);
            }
        }
    },
    '06': function(line) {
        this.recordType = this.recordType || parseInt(line.slice(0, 2));

        this.length = parseInt(line.slice(3, 5)); // veldlengte tekst, het maximum aantal posities is afhankelijk van de classificatiecode: 20 = puntobjecten, 40 = teksten
        this.text = line.slice(6, 46); // tekst
    },
    '07': function(line) {
        this.recordType = parseInt(line.slice(0, 2));
        var r = line.slice(2, 3);

        parser07[r].apply(this, [ line ]);
    },
    '99': function(line) {
        this.recordType = parseInt(line.slice(0, 2));
    }
};

var parser03 = {
    'M': function(subLine) {
        this.lkiCode = subLine.slice(1, 4); // LKI-classificatiecode
    },
    'G': function(subLine) {
        this.geometryType = parseInt(subLine.slice(1, 3)); // soort van het geometrisch primitief: 01 = (knik)punt, 12 = string (2 punten of meer), 13 = cirkelboog door 3 punten
        this.visibility = parseInt(subLine.slice(4, 5)); // zichtbaarheid van object i.v.m. tekeninstructies: 0 = normaal / niet bekend, 1 = boven en onder maaiveld (Z-niveau), 2 = onzichtbaar vanuit de lucht, 3 = vaag of slecht interpreteerbaar
        this.gathering = parseInt(subLine.slice(5, 6)); // wijze van inwinning: 0 = niet bekend (-), 1 = terrestrische meting (T), 2 = fotogrammetrische meting (F), 3 = digitalisering kaart (D), 4 = scanning kaart (S), 
        this.status = parseInt(subLine.slice(6, 7)); // status van het object
    },
    'D': function(subLine) {
        this.date = new Date(subLine.slice(1, 6), subLine.slice(6, 8) - 1, subLine.slice(8, 10)); // opnamedatum van het object
    },
    'B': function(subLine) {
        this.source = subLine.slice(1, 6); // bronvermelding bij het object, bestaande uit: 1 afgekorte naam toegepaste inwinningstechniek zoals: TERR, FOTO, SCAN, 2: afgekorte naam van inwinnende instantie
    }
};

var parser04 = {
    'I': function(subLine) {
        coordinate.function = parseInt(subLine.slice(1, 2)); // functie van het coördinaatpunt: 1 = eerste punt van een object, 2 = rechtlijnige verbinding met het vorige punt, 4 = cirkelboogverbinding met het vorige punt
    },
    'X': function(subLine) {
        coordinate.x = parseInt(subLine.slice(1, 10)); // coördinaatgetal in millimeters
    },
    'Y': function(subLine) {
        coordinate.y = parseInt(subLine.slice(1, 10)); // coördinaatgetal in millimeters
        this.geometry.coordinates.push(coordinate);

        coordinate = {
            // copy function from last
            function: coordinate.function
        };
    },
    'Q': function(subLine) {
        this.geometry.precision = parseInt(subLine.slice(3, 4)); // precisieklasse: 0 = onbekend (LKI-klasse 9), 1 = 1 cm, 2 = 5 cm, 3 = 12 cm, 4 = 23 cm, 5 = 46 cm, 6 = 100 cm, 7 = 250 cm
        this.geometry.deviation = parseInt(subLine.slice(6, 7)); // idealisatieklasse: 0 = onbekend (LKI-klasse 9), 1 = 0 - 2cm, 2 = 2 - 5cm, 3 = 5 - 10 cm, 4 = > 10cm
        this.geometry.reliability = parseInt(subLine.slice(9, 10)); // betrouwbaarheid
    }
}

var parser05 = {
    'F': function(subLine) {
        this.pointOrText = parseInt(subLine.slice(1, 2)); // vast punt van tekst: 0 = plaats onbekend, 1 = linksonder, zie toelichting
        this.status = parseInt(subLine.slice(2, 3)); // status tekst of symbool: 1 = nieuw object, 4 = te verwijderen object
        this.textOrSymbol = parseInt(subLine.slice(3, 4)); // object is tekst of symbool: 1 = tekst, 2 = symbool
        this.symbolType = subLine.slice(4, 10); // symbooltype / schriftsoort: als symbooltype: open- / gesloten verharding: A (05-07) : symbooltype
    },
    'X': function(subLine) {
        coordinate.x = parseInt(subLine.slice(1, 10)); // coördinaatgetal in millimeters
    },
    'Y': function(subLine) {
        coordinate.y = parseInt(subLine.slice(1, 10)); // coördinaatgetal in millimeters

        this.geometry.coordinates.push(coordinate);
        coordinate = {};
    },
    'K': function(subLine) {
        this.lkiCode = subLine.slice(1, 4); // LKI-classificatiecode
    }
}

var parser07 = {
    'N': function(line) {
        this.name = line.slice(3, 38); // naam beheerder
        this.id = line.slice(53, 61); // identificatie van beheerder
    },
    'A': function(line) {
        this.street = line.slice(3, 27), // straatnaam
        this.number = line.slice(27, 32), // huisnummer
        this.number_addition = line.slice(32, 37), // huisnummer toevoeging
        this.zipcode = line.slice(53, 59) // postcode van beheerder
    },
    'W': function(line) {
        this.city = line.slice(3, 27); // vestigingslaats van beheerder
    }
}


module.exports = Nen1878Parser;

});

require.define("events", function (require, module, exports, __dirname, __filename) {
if (!process.EventEmitter) process.EventEmitter = function () {};

var EventEmitter = exports.EventEmitter = process.EventEmitter;
var isArray = typeof Array.isArray === 'function'
    ? Array.isArray
    : function (xs) {
        return Object.toString.call(xs) === '[object Array]'
    }
;

// By default EventEmitters will print a warning if more than
// 10 listeners are added to it. This is a useful default which
// helps finding memory leaks.
//
// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
var defaultMaxListeners = 10;
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!this._events) this._events = {};
  this._events.maxListeners = n;
};


EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {
      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var args = Array.prototype.slice.call(arguments, 1);

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

// EventEmitter is defined in src/node_events.cc
// EventEmitter.prototype.emit() is also defined there.
EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {

    // Check for listener leak
    if (!this._events[type].warned) {
      var m;
      if (this._events.maxListeners !== undefined) {
        m = this._events.maxListeners;
      } else {
        m = defaultMaxListeners;
      }

      if (m && m > 0 && this._events[type].length > m) {
        this._events[type].warned = true;
        console.error('(node) warning: possible EventEmitter memory ' +
                      'leak detected. %d listeners added. ' +
                      'Use emitter.setMaxListeners() to increase limit.',
                      this._events[type].length);
        console.trace();
      }
    }

    // If we've already got an array, just append.
    this._events[type].push(listener);
  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var i = list.indexOf(listener);
    if (i < 0) return this;
    list.splice(i, 1);
    if (list.length == 0)
      delete this._events[type];
  } else if (this._events[type] === listener) {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};

});

require.define("util", function (require, module, exports, __dirname, __filename) {
var events = require('events');

exports.print = function () {};
exports.puts = function () {};
exports.debug = function() {};

exports.inspect = function(obj, showHidden, depth, colors) {
  var seen = [];

  var stylize = function(str, styleType) {
    // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
    var styles =
        { 'bold' : [1, 22],
          'italic' : [3, 23],
          'underline' : [4, 24],
          'inverse' : [7, 27],
          'white' : [37, 39],
          'grey' : [90, 39],
          'black' : [30, 39],
          'blue' : [34, 39],
          'cyan' : [36, 39],
          'green' : [32, 39],
          'magenta' : [35, 39],
          'red' : [31, 39],
          'yellow' : [33, 39] };

    var style =
        { 'special': 'cyan',
          'number': 'blue',
          'boolean': 'yellow',
          'undefined': 'grey',
          'null': 'bold',
          'string': 'green',
          'date': 'magenta',
          // "name": intentionally not styling
          'regexp': 'red' }[styleType];

    if (style) {
      return '\033[' + styles[style][0] + 'm' + str +
             '\033[' + styles[style][1] + 'm';
    } else {
      return str;
    }
  };
  if (! colors) {
    stylize = function(str, styleType) { return str; };
  }

  function format(value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (value && typeof value.inspect === 'function' &&
        // Filter out the util module, it's inspect function is special
        value !== exports &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      return value.inspect(recurseTimes);
    }

    // Primitive types cannot have properties
    switch (typeof value) {
      case 'undefined':
        return stylize('undefined', 'undefined');

      case 'string':
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                                 .replace(/'/g, "\\'")
                                                 .replace(/\\"/g, '"') + '\'';
        return stylize(simple, 'string');

      case 'number':
        return stylize('' + value, 'number');

      case 'boolean':
        return stylize('' + value, 'boolean');
    }
    // For some reason typeof null is "object", so special case here.
    if (value === null) {
      return stylize('null', 'null');
    }

    // Look up the keys of the object.
    var visible_keys = Object_keys(value);
    var keys = showHidden ? Object_getOwnPropertyNames(value) : visible_keys;

    // Functions without properties can be shortcutted.
    if (typeof value === 'function' && keys.length === 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        var name = value.name ? ': ' + value.name : '';
        return stylize('[Function' + name + ']', 'special');
      }
    }

    // Dates without properties can be shortcutted
    if (isDate(value) && keys.length === 0) {
      return stylize(value.toUTCString(), 'date');
    }

    var base, type, braces;
    // Determine the object type
    if (isArray(value)) {
      type = 'Array';
      braces = ['[', ']'];
    } else {
      type = 'Object';
      braces = ['{', '}'];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      var n = value.name ? ': ' + value.name : '';
      base = (isRegExp(value)) ? ' ' + value : ' [Function' + n + ']';
    } else {
      base = '';
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + value.toUTCString();
    }

    if (keys.length === 0) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        return stylize('[Object]', 'special');
      }
    }

    seen.push(value);

    var output = keys.map(function(key) {
      var name, str;
      if (value.__lookupGetter__) {
        if (value.__lookupGetter__(key)) {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Getter/Setter]', 'special');
          } else {
            str = stylize('[Getter]', 'special');
          }
        } else {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Setter]', 'special');
          }
        }
      }
      if (visible_keys.indexOf(key) < 0) {
        name = '[' + key + ']';
      }
      if (!str) {
        if (seen.indexOf(value[key]) < 0) {
          if (recurseTimes === null) {
            str = format(value[key]);
          } else {
            str = format(value[key], recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (isArray(value)) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = stylize('[Circular]', 'special');
        }
      }
      if (typeof name === 'undefined') {
        if (type === 'Array' && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length - 2);
          name = stylize(name, 'name');
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
          name = stylize(name, 'string');
        }
      }

      return name + ': ' + str;
    });

    seen.pop();

    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0) numLinesEst++;
      return prev + cur.length + 1;
    }, 0);

    if (length > 50) {
      output = braces[0] +
               (base === '' ? '' : base + '\n ') +
               ' ' +
               output.join(',\n  ') +
               ' ' +
               braces[1];

    } else {
      output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }

    return output;
  }
  return format(obj, (typeof depth === 'undefined' ? 2 : depth));
};


function isArray(ar) {
  return ar instanceof Array ||
         Array.isArray(ar) ||
         (ar && ar !== Object.prototype && isArray(ar.__proto__));
}


function isRegExp(re) {
  return re instanceof RegExp ||
    (typeof re === 'object' && Object.prototype.toString.call(re) === '[object RegExp]');
}


function isDate(d) {
  if (d instanceof Date) return true;
  if (typeof d !== 'object') return false;
  var properties = Date.prototype && Object_getOwnPropertyNames(Date.prototype);
  var proto = d.__proto__ && Object_getOwnPropertyNames(d.__proto__);
  return JSON.stringify(proto) === JSON.stringify(properties);
}

function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}

exports.log = function (msg) {};

exports.pump = null;

var Object_keys = Object.keys || function (obj) {
    var res = [];
    for (var key in obj) res.push(key);
    return res;
};

var Object_getOwnPropertyNames = Object.getOwnPropertyNames || function (obj) {
    var res = [];
    for (var key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) res.push(key);
    }
    return res;
};

var Object_create = Object.create || function (prototype, properties) {
    // from es5-shim
    var object;
    if (prototype === null) {
        object = { '__proto__' : null };
    }
    else {
        if (typeof prototype !== 'object') {
            throw new TypeError(
                'typeof prototype[' + (typeof prototype) + '] != \'object\''
            );
        }
        var Type = function () {};
        Type.prototype = prototype;
        object = new Type();
        object.__proto__ = prototype;
    }
    if (typeof properties !== 'undefined' && Object.defineProperties) {
        Object.defineProperties(object, properties);
    }
    return object;
};

exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object_create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

});

require.define("/nen1878_string_reader.js", function (require, module, exports, __dirname, __filename) {
"use strict";

var events = require('events');
var util = require('util');
var fs = require('fs');


var LINE_SIZE = 64 + 2; // line size + \r\n


util.inherits(Nen1878StringReader, events.EventEmitter);


function Nen1878StringReader(parser, string) {
    this.parser = parser;
    this.string = string;
}


Nen1878StringReader.prototype.start = function() {
    var index = 0;
    while (index < this.string.length) {
        // split buffer to single lines
        var line = this.string.slice(index, index + LINE_SIZE);
        line = line.slice(0, LINE_SIZE - 2); // cut off the \r\n
        line = line.toString();
        index += LINE_SIZE;

        this.parser.parseLine(line);
    }

    this.emit('end');
}


module.exports = Nen1878StringReader;

});

require.define("fs", function (require, module, exports, __dirname, __filename) {
// nothing to see here... no file methods for the browser

});

require.define("/browserify.js", function (require, module, exports, __dirname, __filename) {
    var nen1878reader = {
    GeoJson: require('./geojson'),
    Nen1878Parser: require('./nen1878_parser'),
    Nen1878StringReader: require('./nen1878_string_reader'),
};

// assume this script is run in a function with context as first argument
window.nen1878reader = nen1878reader;

});
require("/browserify.js");

