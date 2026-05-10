using System.Collections.Generic;

namespace HexBattle.Core
{
    /// <summary>
    /// Full Gen 6 type effectiveness chart.
    /// Ported directly from hex_battle.py _EFF dictionary.
    /// Missing entries imply 1.0 (normal effectiveness).
    /// </summary>
    public static class TypeChart
    {
        // Outer key = attacking type, inner key = defending type, value = multiplier
        private static readonly Dictionary<string, Dictionary<string, float>> _chart
            = new()
        {
            ["Normal"]   = new() { ["Rock"]=0.5f, ["Ghost"]=0f,   ["Steel"]=0.5f },
            ["Fire"]     = new() { ["Fire"]=0.5f, ["Water"]=0.5f, ["Grass"]=2f,
                                   ["Ice"]=2f,    ["Bug"]=2f,     ["Rock"]=0.5f,
                                   ["Dragon"]=0.5f,["Steel"]=2f },
            ["Water"]    = new() { ["Fire"]=2f,   ["Water"]=0.5f, ["Grass"]=0.5f,
                                   ["Ground"]=2f,  ["Rock"]=2f,    ["Dragon"]=0.5f },
            ["Electric"] = new() { ["Water"]=2f,  ["Electric"]=0.5f,["Grass"]=0.5f,
                                   ["Ground"]=0f,  ["Flying"]=2f,  ["Dragon"]=0.5f },
            ["Grass"]    = new() { ["Fire"]=0.5f, ["Water"]=2f,   ["Grass"]=0.5f,
                                   ["Poison"]=0.5f,["Ground"]=2f,  ["Flying"]=0.5f,
                                   ["Bug"]=0.5f,  ["Rock"]=2f,    ["Dragon"]=0.5f,
                                   ["Steel"]=0.5f },
            ["Ice"]      = new() { ["Fire"]=0.5f, ["Water"]=0.5f, ["Grass"]=2f,
                                   ["Ice"]=0.5f,  ["Ground"]=2f,  ["Flying"]=2f,
                                   ["Dragon"]=2f, ["Steel"]=0.5f },
            ["Fighting"] = new() { ["Normal"]=2f, ["Ice"]=2f,     ["Poison"]=0.5f,
                                   ["Flying"]=0.5f,["Psychic"]=0.5f,["Bug"]=0.5f,
                                   ["Rock"]=2f,   ["Ghost"]=0f,   ["Dark"]=2f,
                                   ["Steel"]=2f,  ["Fairy"]=0.5f },
            ["Poison"]   = new() { ["Grass"]=2f,  ["Poison"]=0.5f,["Ground"]=0.5f,
                                   ["Rock"]=0.5f, ["Ghost"]=0.5f, ["Steel"]=0f,
                                   ["Fairy"]=2f },
            ["Ground"]   = new() { ["Fire"]=2f,   ["Electric"]=2f,["Grass"]=0.5f,
                                   ["Poison"]=2f, ["Flying"]=0f,  ["Bug"]=0.5f,
                                   ["Rock"]=2f,   ["Steel"]=2f },
            ["Flying"]   = new() { ["Electric"]=0.5f,["Grass"]=2f,["Fighting"]=2f,
                                   ["Bug"]=2f,    ["Rock"]=0.5f,  ["Steel"]=0.5f },
            ["Psychic"]  = new() { ["Fighting"]=2f,["Poison"]=2f, ["Psychic"]=0.5f,
                                   ["Dark"]=0f,   ["Steel"]=0.5f },
            ["Bug"]      = new() { ["Fire"]=0.5f, ["Grass"]=2f,   ["Fighting"]=0.5f,
                                   ["Poison"]=0.5f,["Flying"]=0.5f,["Ghost"]=0.5f,
                                   ["Psychic"]=2f,["Dark"]=2f,    ["Steel"]=0.5f,
                                   ["Fairy"]=0.5f },
            ["Rock"]     = new() { ["Fire"]=2f,   ["Ice"]=2f,     ["Fighting"]=0.5f,
                                   ["Ground"]=0.5f,["Flying"]=2f, ["Bug"]=2f,
                                   ["Steel"]=0.5f },
            ["Ghost"]    = new() { ["Normal"]=0f, ["Psychic"]=2f, ["Ghost"]=2f,
                                   ["Dark"]=0.5f },
            ["Dragon"]   = new() { ["Dragon"]=2f, ["Steel"]=0.5f, ["Fairy"]=0f },
            ["Dark"]     = new() { ["Fighting"]=0.5f,["Psychic"]=2f,["Ghost"]=2f,
                                   ["Dark"]=0.5f, ["Fairy"]=0.5f },
            ["Steel"]    = new() { ["Fire"]=0.5f, ["Water"]=0.5f, ["Electric"]=0.5f,
                                   ["Ice"]=2f,    ["Rock"]=2f,    ["Steel"]=0.5f,
                                   ["Fairy"]=2f },
            ["Fairy"]    = new() { ["Fire"]=0.5f, ["Poison"]=0.5f,["Fighting"]=2f,
                                   ["Dragon"]=2f, ["Dark"]=2f,    ["Steel"]=0.5f },
        };

        /// <summary>
        /// Returns the type effectiveness multiplier for a single attacking type
        /// against a single defending type (0, 0.5, 1, or 2).
        /// </summary>
        public static float Get(string attackType, string defendType)
        {
            if (_chart.TryGetValue(attackType, out var inner)
                && inner.TryGetValue(defendType, out float mult))
                return mult;
            return 1f;
        }

        /// <summary>
        /// Returns the combined effectiveness against a defender with
        /// one or more types (product of individual matchups).
        /// </summary>
        public static float GetCombined(string attackType, string[] defendTypes)
        {
            float mult = 1f;
            foreach (var dt in defendTypes)
                mult *= Get(attackType, dt);
            return mult;
        }
    }
}
