var Board = require('./board.js')
var Tuple = require('../lib/tuple')

var uuid = require('../lib/node-uuid')
var fs = require('fs')
var setting = require('remote').require('./module/setting')

var alpha = 'abcdefghijklmnopqrstuvwxyz'

exports.tokenize = function(input) {
    var tokens = []
    var builder = ''
    var propIdentRegex = /^[A-Za-z]+/

    var i = 0
    var inCValueType = false
    var inBackslash = false

    while (i < input.length) {
        if (!inCValueType) {
            builder = ''
            inBackslash = false

            switch (input[i]) {
                case '(':
                    tokens.push(new Tuple('parenthesis', '('))
                    i++
                    break
                case ')':
                    tokens.push(new Tuple('parenthesis', ')'))
                    i++
                    break
                case ';':
                    tokens.push(new Tuple('semicolon', ';'))
                    i++
                    break
                case '[':
                    inCValueType = true
                    i++
                    break
                default:
                    if (/\s/.test(input[i])) {
                        i++
                        break
                    }

                    var match = propIdentRegex.exec(input.slice(i))[0]

                    if (match != null) {
                        tokens.push(new Tuple('prop_ident', match))
                        i += match.length
                    } else {
                        return []
                    }

                    break
            }
        } else {
            if (!inBackslash) {
                switch (input[i]) {
                    case '\\':
                        inBackslash = true
                        break
                    case '\n':
                        builder += '\n'
                        break
                    case ']':
                        inCValueType = false
                        tokens.push(new Tuple('c_value_type', builder))
                        break
                    default:
                        builder += input[i]
                        break
                }
            } else {
                inBackslash = false
                builder += input[i]
            }

            i++
        }
    }

    return tokens
}

exports.parse = function(tokens, start, end) {
    if (arguments.length <= 2) end = tokens.length - 1
    if (arguments.length <= 1) start = 0

    var i = start

    var node, property, tree = {
        id: uuid.v4(),
        nodes: [],
        subtrees: [],
        parent: null,
        current: null
    }

    while (i <= end) {
        if (new Tuple('parenthesis', '(').equals(tokens[i])) break
        if (new Tuple('parenthesis', ')').equals(tokens[i])) return null

        tokens[i].unpack(function(type, data) {
            if (type == 'semicolon') {
                node = {}
                tree.nodes.push(node)
            } else if (type == 'prop_ident') {
                node[data] = []
                property = node[data]
            } else if (type == 'c_value_type') {
                property.push(data)
            }
        })

        i++
    }

    var depth = 0
    var newstart = 0

    while (i <= end) {
        if (new Tuple('parenthesis', '(').equals(tokens[i])) {
            depth++
            if (depth == 1) newstart = i + 1
        } else if (new Tuple('parenthesis', ')').equals(tokens[i])) {
            depth--
            if (depth == 0) {
                t = exports.parse(tokens, newstart, i - 1)
                t.parent = tree
                tree.subtrees.push(t)
                tree.current = 0
            }
        }

        i++
    }

    return tree
}

exports.parseFile = function(filename) {
    var input = fs.readFileSync(filename, { encoding: 'utf8' })
    var tokens = exports.tokenize(input)

    return exports.parse(tokens)
}

exports.point2vertex = function(point) {
    if (point.length != 2) return new Tuple(-1, -1)

    point = point.toLowerCase()
    return new Tuple(alpha.indexOf(point[0]), alpha.indexOf(point[1]))
}

exports.vertex2point = function(tuple) {
    return tuple.unpack(function(x, y) {
        if (x < 0 || y < 0) return ''
        return alpha[x] + alpha[y]
    })
}

exports.compressed2list = function(compressed) {
    var colon = compressed.indexOf(':')
    if (colon < 0) return [exports.point2vertex(compressed)]

    var v1 = exports.point2vertex(compressed.slice(0, colon))
    var v2 = exports.point2vertex(compressed.slice(colon + 1))
    var list = []

    for (var i = v1[0]; i <= v2[0]; i++) {
        for (var j = v1[1]; j <= v2[1]; j++) {
            list.push(new Tuple(i, j))
        }
    }

    return list
}

exports.navigate = function(tree, index, step) {
    if (index + step >= 0 && index + step < tree.nodes.length) {
        return new Tuple(tree, index + step)
    } else if (index + step < 0 && tree.parent) {
        var prev = tree.parent
        index = prev.nodes.length + index + step

        if (index >= 0)
            return new Tuple(prev, index)
        else if (prev.parent)
            return new Tuple(prev.parent, prev.parent.nodes.length - 1)
    } else if (index + step >= tree.nodes.length && tree.current != null) {
        index = index + step - tree.nodes.length
        var next = tree.subtrees[tree.current]

        if (index < next.nodes.length)
            return new Tuple(next, index)
        else if (next.current != null)
            return new Tuple(next.subtrees[next.current], 0)
    }

    return new Tuple(null, 0)
}

exports.addBoard = function(tree, index, baseboard) {
    if (isNaN(index)) index = 0
    if (index >= tree.nodes.length) return tree

    var node = tree.nodes[index]
    var vertex = null
    var board = null

    if (!baseboard) {
        var prev = exports.navigate(tree, index, -1)

        if (!prev[0]) {
            var size = 'SZ' in node ? node.SZ[0].toInt() : 19
            baseboard = new Board(size)
        } else {
            var prevNode = prev[0].nodes[prev[1]]

            if (!prevNode.board) exports.addBoard(prev[0], prev[1])
            baseboard = prevNode.board
        }
    }

    if ('B' in node) {
        vertex = exports.point2vertex(node.B[0])
        board = baseboard.makeMove(1, vertex)
    } else if ('W' in node) {
        vertex = exports.point2vertex(node.W[0])
        board = baseboard.makeMove(-1, vertex)
    } else {
        board = baseboard.makeMove(0)
    }

    var ids = ['AW', 'AE', 'AB']

    for (var i = 0; i < ids.length; i++) {
        if (!(ids[i] in node)) continue

        node[ids[i]].each(function(value) {
            if (value.indexOf(':') < 0) {
                // Single point
                board.arrangement[exports.point2vertex(value)] = i - 1
            } else {
                // Compressed point list
                exports.compressed2list(value).each(function(vertex) {
                    board.arrangement[vertex] = i - 1
                })
            }
        })
    }

    if (vertex != null) {
        board.overlays[vertex] = new Tuple('point', 0, '')
    }

    var ids = ['CR', 'MA', 'SQ', 'TR']
    var classes = ['circle', 'cross', 'square', 'triangle']

    for (var i = 0; i < ids.length; i++) {
        if (!(ids[i] in node)) continue

        node[ids[i]].each(function(value) {
            if (value.indexOf(':') < 0) {
                // Single point
                board.overlays[exports.point2vertex(value)] = new Tuple(classes[i], 0, '')
            } else {
                // Compressed point list
                exports.compressed2list(value).each(function(vertex) {
                    board.overlays[vertex] = new Tuple(classes[i], 0, '')
                })
            }
        })
    }

    if ('LB' in node) {
        node.LB.each(function(composed) {
            var sep = composed.indexOf(':')
            var point = composed.slice(0, sep)
            var label = composed.slice(sep + 1).replace(/\s+/, ' ')
            board.overlays[exports.point2vertex(point)] = new Tuple('label', 0, label)
        })
    }

    node.board = board

    if (index == tree.nodes.length - 1 && tree.subtrees.length > 0) {
        // Add variations

        tree.subtrees.each(function(subtree) {
            if (subtree.nodes.length == 0) return

            var v, sign

            if ('B' in subtree.nodes[0]) {
                v = sgf.point2vertex(subtree.nodes[0].B[0])
                sign = 1
            } else if ('W' in subtree.nodes[0]) {
                v = sgf.point2vertex(subtree.nodes[0].W[0])
                sign = -1
            } else {
                return
            }

            if (v in board.overlays)
                board.overlays[v] = board.overlays[v].unpack(function(a, b, c) {
                     return new Tuple(a, sign, c)
                })
            else board.overlays[v] = new Tuple('', sign, '')
        })
    }

    return tree
}

exports.splitTree = function(tree, index) {
    if (index < 0 || index >= tree.nodes.length - 1) return tree

    var newnodes = tree.nodes.slice(0, index + 1)
    tree.nodes = tree.nodes.slice(index + 1)

    var newtree = {
        id: uuid.v4(),
        nodes: newnodes,
        subtrees: [tree],
        parent: tree.parent,
        current: 0
    }
    tree.parent = newtree

    if (newtree.parent != null) {
        newtree.parent.subtrees[newtree.parent.subtrees.indexOf(tree)] = newtree
    }

    return newtree
}

exports.reduceTree = function(tree) {
    if (tree.subtrees.length != 1) return tree

    tree.nodes = tree.nodes.concat(tree.subtrees[0].nodes)
    tree.current = tree.subtrees[0].current
    tree.subtrees = tree.subtrees[0].subtrees

    tree.subtrees.each(function(subtree) {
        subtree.parent = tree
    })

    return tree
}

exports.tree2string = function(tree) {
    var output = ''

    tree.nodes.each(function(node) {
        output += ';'

        Object.each(node, function(values, id) {
            if (id.toUpperCase() != id) return
            output += id

            values.each(function(value) {
                output += '[' + exports.escapeString(value.toString()) + ']'
            })
        })

        output += '\n'
    })

    if (tree.current != null)
        output += '(' + exports.tree2string(tree.subtrees[tree.current]) + ')'

    for (var i = 0; i < tree.subtrees.length; i++) {
        if (i == tree.current) continue
        output += '(' + exports.tree2string(tree.subtrees[i]) + ')'
    }

    return output
}

exports.escapeString = function(input) {
    return input.replace('\\', '\\\\').replace(']', '\\]')
}

exports.getHeight = function(tree) {
    var depth = 0

    tree.subtrees.each(function(subtree) {
        depth = Math.max(exports.getHeight(subtree), depth)
    })

    return depth + tree.nodes.length
}

exports.getCurrentHeight = function(tree) {
    var depth = tree.nodes.length

    if (tree.current != null)
        depth += exports.getCurrentHeight(tree.subtrees[tree.current])

    return depth
}

exports.tree2matrixdict = function(tree, matrix, dict, xshift, yshift) {
    if (!matrix) matrix = Array.apply(null, new Array(exports.getHeight(tree))).map(function() { return [] });
    if (!dict) dict = {}
    if (!xshift) xshift = 0
    if (!yshift) yshift = 0

    var hasCollisions = true
    while (hasCollisions) {
        hasCollisions = false

        for (var y = 0; y < Math.min(tree.nodes.length + 1, matrix.length - yshift); y++) {
            if (xshift < matrix[yshift + y].length) {
                hasCollisions = true
                xshift++
                break
            }
        }
    }

    for (var y = 0; y < tree.nodes.length; y++) {
        while (xshift >= matrix[yshift + y].length) {
            matrix[yshift + y].push(null)
        }

        matrix[yshift + y][xshift] = new Tuple(tree, y)
        dict[tree.id + '-' + y] = new Tuple(xshift, yshift + y)
    }

    for (var k = 0; k < tree.subtrees.length; k++) {
        var subtree = tree.subtrees[k]
        exports.tree2matrixdict(subtree, matrix, dict, xshift, yshift + tree.nodes.length)
    }

    return new Tuple(matrix, dict)
}

exports.matrix2graph = function(matrixdict) {
    var matrix = matrixdict[0]
    var dict = matrixdict[1]
    var graph = { nodes: [], edges: [] }
    var width = Math.max.apply(null, matrix.map(function(x) { return x.length }))
    var gridSize = setting.get('graph.grid_size')

    for (x = 0; x < width; x++) {
        for (y = 0; y < matrix.length; y++) {
            if (!matrix[y][x]) continue

            var tree = matrix[y][x][0]
            var index = matrix[y][x][1]
            var id = tree.id + '-' + index

            graph.nodes.push({
                'id': id,
                'x': x * gridSize,
                'y': y * gridSize,
                'size': 4,
                'data': matrix[y][x]
            })

            var prev = exports.navigate(tree, index, -1)
            if (!prev[0]) continue
            var prevId = prev[0].id + '-' + prev[1]
            var prevPos = dict[prevId]

            if (prevPos[0] != x) {
                graph.nodes.push({
                    'id': id + '-h',
                    'x': (x - 1) * gridSize,
                    'y': (y - 1) * gridSize,
                    'size': 0
                })

                graph.edges.push({
                    'id': id + '-e1',
                    'source': id,
                    'target': id + '-h'
                })

                graph.edges.push({
                    'id': id + '-e2',
                    'source': id + '-h',
                    'target': prevId
                })
            } else {
                graph.edges.push({
                    'id': id + '-e1',
                    'source': id,
                    'target': prevId
                })
            }
        }
    }

    return graph
}

exports.tree2graph = function(tree) {
    return exports.matrix2graph(exports.tree2matrixdict(tree))
}
