using System;

namespace HexBattle.Core
{
    public enum MoveCategory
    {
        Physical,
        Special,
        Status,
        Terrain
    }

    public enum ActionOrder
    {
        AttackFirst,
        MoveFirst
    }

    public enum ActionType
    {
        Move,
        Attack
    }

    public enum GamePhase
    {
        Waiting,
        Selection,
        Declaration,
        Resolution,
        EndOfTurn,
        GameOver
    }

    public enum TerrainType
    {
        None,
        SlowZone,       // Mud Shot — doubles step cost
        PoisonTrap,     // Toxic — poisons on entry
        BurnZone,       // Will-O-Wisp — 1/8 HP/turn
        MistZone,       // Misty Terrain — blocks stat drops
        SunnyZone,      // Sunny Day — Fire x1.5, Water x0.5
        RainZone,       // Rain Dance — Water x1.5, Fire x0.5
        FogZone,        // Haze — reduces accuracy
        ResonanceZone,  // Metal Sound — -1 SpDef/turn
        PeishZone,      // Perish Trap — 3-turn countdown
        IceZone,        // Hail — chip damage non-Ice types
        RockTrap,       // Stealth Rock — Rock-type damage on entry
        RockPile,       // Moves blocked (impassable)
        TreeObstacle    // Moves blocked
    }

    public enum HighlightType
    {
        None,
        MoveRange,
        AttackRange,
        Path,
        AoeRange,
        Target
    }

    public enum StatName
    {
        Attack,
        Defense,
        SpAtk,
        SpDef,
        Speed
    }

    public enum StatusCondition
    {
        None,
        Paralyzed,
        Burned,
        Taunted,
        Flinched,
        Hypnotized
    }

    public enum HighlightMode
    {
        None,
        Move,
        Attack
    }
}
