'use strict';
/**
 * levels.js - Brick Breaker's levels (original layouts).
 *
 * The field is played sideways to suit the wide iDrive screen: the paddle runs up and down the
 * left edge and the wall of bricks stands on the right. Each level is ROWS strings (top to
 * bottom) of COLS characters (left = nearest the paddle, right = the back wall):
 *
 *   .   empty
 *   1-3 a brick that takes that many hits
 *   #   steel: can't be broken, doesn't count for clearing the level
 *   *   a bonus brick (one hit, always drops a power-up)
 */
const ROWS = 9, COLS = 12;

const LEVELS = [
    {
        name: 'Warm-up',
        map: [
            '....11111111',
            '....11111111',
            '....11111111',
            '....22222222',
            '....11*11*11',
            '....22222222',
            '....11111111',
            '....11111111',
            '....11111111',
        ],
    },
    {
        name: 'Arrowhead',
        map: [
            '.........111',
            '.......11222',
            '.....1122233',
            '...112223333',
            '.11*22233333',
            '...112223333',
            '.....1122233',
            '.......11222',
            '.........111',
        ],
    },
    {
        name: 'Lanes',
        map: [
            '...111111111',
            '...#########',
            '...2222*2222',
            '............',
            '...333333333',
            '............',
            '...2222*2222',
            '...#########',
            '...111111111',
        ],
    },
    {
        name: 'Checkers',
        map: [
            '..1.2.1.2.1.',
            '..2.1.2.1.2.',
            '..1.2.*.2.1.',
            '..2.1.2.1.2.',
            '..1.2.1.2.1.',
            '..2.1.2.1.2.',
            '..1.2.*.2.1.',
            '..2.1.2.1.2.',
            '..1.2.1.2.1.',
        ],
    },
    {
        name: 'Gatehouse',
        map: [
            '....######..',
            '....#2222#..',
            '....#3333#11',
            '......*..#11',
            '.......3...1',
            '......*..#11',
            '....#3333#11',
            '....#2222#..',
            '....######..',
        ],
    },
    {
        name: 'Tide',
        map: [
            '.....1....33',
            '....121..333',
            '...12321.333',
            '..1232*21.33',
            '...12321.333',
            '....121..333',
            '.....1....33',
            '...........#',
            '..########.#',
        ],
    },
    {
        name: 'Hourglass',
        map: [
            '..3333333333',
            '...22222222.',
            '....111111..',
            '.....1**1...',
            '......##....',
            '.....1111...',
            '....222222..',
            '...33333333.',
            '..3333333333',
        ],
    },
    {
        name: 'Fortress',
        map: [
            '..#.#.#.2222',
            '..3.3.3.2112',
            '..2.2.2.2**2',
            '..1.1.1.2112',
            '........1111',
            '..1.1.1.2112',
            '..2.2.2.2112',
            '..3.3.3.2222',
            '..#.#.#.####',
        ],
    },
];

module.exports = { LEVELS, ROWS, COLS };
